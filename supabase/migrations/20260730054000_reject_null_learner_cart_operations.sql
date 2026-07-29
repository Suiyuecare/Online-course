-- Reject a NULL cart operation at the database boundary. The application
-- schema already rejects it, but authenticated callers must not be able to
-- turn an omitted operation into an implicit merge through SQL three-valued
-- logic.

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
grant execute on function internal.sync_own_learner_cart(text, uuid[])
  to authenticated;
