-- Course favorites are a private learner preference. They intentionally bind
-- to the stable course identity so a newly published course version does not
-- discard the learner's saved item.

create table public.course_favorites (
  person_id uuid not null
    references public.people(id) on delete cascade,
  course_id uuid not null
    references public.courses(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (person_id, course_id)
);

create index course_favorites_recent_idx
  on public.course_favorites(person_id, created_at desc, course_id);

create index course_favorites_course_idx
  on public.course_favorites(course_id, person_id);

alter table public.course_favorites enable row level security;
alter table public.course_favorites force row level security;

revoke all on table public.course_favorites
  from public, anon, authenticated, service_role;

grant select on table public.course_favorites to authenticated;
grant select on table public.course_favorites to service_role;

create policy course_favorites_owner_read
on public.course_favorites
for select
to authenticated
using (person_id = (select internal.request_person_id()));

create or replace function internal.set_own_course_favorite(
  submitted_course_slug text,
  submitted_favorited boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  target_course uuid;
  changed_rows integer := 0;
begin
  if submitted_course_slug is null
     or submitted_course_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or char_length(submitted_course_slug) > 160
     or submitted_favorited is null
  then
    raise exception 'COURSE_FAVORITE_INVALID';
  end if;

  if submitted_favorited then
    select course.id into target_course
    from public.courses course
    where course.slug = submitted_course_slug
      and exists (
        select 1
        from public.published_course_catalog catalog
        where catalog.slug = course.slug
      );
    if target_course is null then
      raise exception 'COURSE_NOT_FAVORITABLE';
    end if;

    insert into public.course_favorites (person_id, course_id)
    values (actor, target_course)
    on conflict (person_id, course_id) do nothing;
    get diagnostics changed_rows = row_count;
  else
    select course.id into target_course
    from public.courses course
    where course.slug = submitted_course_slug;

    if target_course is not null then
      delete from public.course_favorites favorite
      where favorite.person_id = actor
        and favorite.course_id = target_course;
      get diagnostics changed_rows = row_count;
    end if;
  end if;

  return jsonb_build_object(
    'slug', submitted_course_slug,
    'favorited', submitted_favorited,
    'changed', changed_rows > 0
  );
end
$$;

revoke all on function internal.set_own_course_favorite(text, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.set_own_course_favorite(
  p_course_slug text,
  p_favorited boolean
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.set_own_course_favorite(
    p_course_slug,
    p_favorited
  )
$$;

revoke all on function public.set_own_course_favorite(text, boolean)
  from public, anon, authenticated, service_role;

grant execute on function internal.set_own_course_favorite(text, boolean)
  to authenticated;
grant execute on function public.set_own_course_favorite(text, boolean)
  to authenticated;
