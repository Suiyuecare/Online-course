-- The cart is an account-backed preference, not a quote or an order. It stores
-- only stable course-version identities. Every displayed price and availability
-- flag is rebuilt from authoritative course data, and checkout continues to
-- create one manual-transfer order per course.

create table public.learner_cart_items (
  person_id uuid not null
    references public.people(id) on delete cascade,
  course_version_id uuid not null
    references public.course_versions(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (person_id, course_version_id)
);

create index learner_cart_items_course_version_idx
  on public.learner_cart_items(course_version_id, person_id);

alter table public.learner_cart_items enable row level security;
alter table public.learner_cart_items force row level security;

revoke all on table public.learner_cart_items
  from public, anon, authenticated, service_role;

grant select on table public.learner_cart_items to authenticated;
grant select on table public.learner_cart_items to service_role;

create policy learner_cart_items_owner_read
on public.learner_cart_items
for select
to authenticated
using (person_id = (select internal.request_person_id()));

create or replace function internal.learner_cart_payload(
  target_person uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'items',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'courseVersionId', cart.course_version_id,
          'slug', course.slug,
          'title', version.title,
          'priceTwd', version.price_twd,
          'deliveryType', version.delivery_type,
          'hasCover', version.has_cover,
          'available', (
            course.archived_at is null
            and exists (
              select 1
              from public.published_course_catalog catalog
              where catalog.course_version_id = version.id
            )
          ),
          'addedAt', cart.created_at
        )
        order by cart.created_at, cart.course_version_id
      ),
      '[]'::jsonb
    ),
    'rejectedCourseVersionIds',
    '[]'::jsonb
  )
  from public.learner_cart_items cart
  join public.course_versions version
    on version.id = cart.course_version_id
  join public.courses course
    on course.id = version.course_id
  where cart.person_id = target_person
$$;

revoke all on function internal.learner_cart_payload(uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.read_own_learner_cart()
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.learner_cart_payload(
    internal.current_person_id()
  )
$$;

revoke all on function internal.read_own_learner_cart()
  from public, anon, authenticated, service_role;

create or replace function public.read_own_learner_cart()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_own_learner_cart()
$$;

revoke all on function public.read_own_learner_cart()
  from public, anon, authenticated, service_role;

grant execute on function internal.read_own_learner_cart()
  to authenticated;
grant execute on function public.read_own_learner_cart()
  to authenticated;

create or replace function internal.sync_own_learner_cart(
  submitted_operation text,
  submitted_course_version_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  submitted_ids uuid[] := coalesce(
    submitted_course_version_ids,
    '{}'::uuid[]
  );
  submitted_id uuid;
  current_count integer;
  remaining_slots integer;
  rejected_ids uuid[] := '{}'::uuid[];
begin
  if submitted_operation is null
     or submitted_operation not in ('merge', 'add', 'remove')
     or cardinality(submitted_ids) > 100
     or array_position(submitted_ids, null) is not null
     or (
       submitted_operation in ('add', 'remove')
       and cardinality(submitted_ids) <> 1
     )
  then
    raise exception 'LEARNER_CART_INVALID';
  end if;

  -- Serialize cart writes across devices and keep the 100-item bound exact.
  perform 1
  from public.people person
  where person.id = actor
  for update;

  if submitted_operation = 'remove' then
    delete from public.learner_cart_items cart
    where cart.person_id = actor
      and cart.course_version_id = submitted_ids[1];
  elsif submitted_operation = 'add' then
    submitted_id := submitted_ids[1];
    if not exists (
      select 1
      from public.published_course_catalog catalog
      where catalog.course_version_id = submitted_id
    ) then
      raise exception 'LEARNER_CART_COURSE_UNAVAILABLE';
    end if;

    if not exists (
      select 1
      from public.learner_cart_items cart
      where cart.person_id = actor
        and cart.course_version_id = submitted_id
    ) then
      select count(*)::integer into current_count
      from public.learner_cart_items cart
      where cart.person_id = actor;
      if current_count >= 100 then
        raise exception 'LEARNER_CART_LIMIT_REACHED';
      end if;
      insert into public.learner_cart_items (
        person_id,
        course_version_id
      ) values (
        actor,
        submitted_id
      );
    end if;
  else
    select count(*)::integer into current_count
    from public.learner_cart_items cart
    where cart.person_id = actor;
    remaining_slots := greatest(0, 100 - current_count);

    with submitted as (
      select
        candidate.course_version_id,
        min(candidate.ordinality) as first_ordinality
      from unnest(submitted_ids) with ordinality
        as candidate(course_version_id, ordinality)
      group by candidate.course_version_id
    ),
    accepted as (
      select submitted.course_version_id
      from submitted
      join public.published_course_catalog catalog
        on catalog.course_version_id = submitted.course_version_id
      where not exists (
        select 1
        from public.learner_cart_items existing
        where existing.person_id = actor
          and existing.course_version_id = submitted.course_version_id
      )
      order by submitted.first_ordinality
      limit remaining_slots
    )
    insert into public.learner_cart_items (
      person_id,
      course_version_id
    )
    select actor, accepted.course_version_id
    from accepted
    on conflict (person_id, course_version_id) do nothing;

    select coalesce(
      array_agg(candidate.course_version_id order by candidate.ordinality),
      '{}'::uuid[]
    )
    into rejected_ids
    from unnest(submitted_ids) with ordinality
      as candidate(course_version_id, ordinality)
    where not exists (
      select 1
      from public.learner_cart_items cart
      where cart.person_id = actor
        and cart.course_version_id = candidate.course_version_id
    );
  end if;

  return internal.learner_cart_payload(actor)
    || jsonb_build_object(
      'rejectedCourseVersionIds',
      to_jsonb(rejected_ids)
    );
end
$$;

revoke all on function internal.sync_own_learner_cart(text, uuid[])
  from public, anon, authenticated, service_role;

create or replace function public.sync_own_learner_cart(
  p_operation text,
  p_course_version_ids uuid[]
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.sync_own_learner_cart(
    p_operation,
    p_course_version_ids
  )
$$;

revoke all on function public.sync_own_learner_cart(text, uuid[])
  from public, anon, authenticated, service_role;

grant execute on function internal.sync_own_learner_cart(text, uuid[])
  to authenticated;
grant execute on function public.sync_own_learner_cart(text, uuid[])
  to authenticated;
