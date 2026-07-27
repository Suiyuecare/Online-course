-- Apply current provider-evidence TTL to anonymous preview authorization.
-- The helper is introduced by the immediately preceding provider-TTL migration.

create or replace function internal.authorize_public_course_preview(
  target_course_version uuid,
  target_lesson uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  preview_asset record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'PREVIEW_SERVICE_AUTHORITY_REQUIRED';
  end if;

  select
    asset.provider_uid,
    asset.duration_seconds
  into preview_asset
  from public.published_course_catalog catalog
  join public.modules module
    on module.course_version_id = catalog.course_version_id
  join public.lessons lesson
    on lesson.module_id = module.id
  join lateral (
    select asset.*
    from public.lesson_video_versions video_version
    join public.video_assets asset
      on asset.id = video_version.video_asset_id
    where video_version.lesson_id = lesson.id
      and video_version.active
    order by video_version.version desc, video_version.id
    limit 1
  ) asset on true
  where catalog.course_version_id = target_course_version
    and lesson.id = target_lesson
    and lesson.archived_at is null
    and lesson.content_type = 'video'
    and lesson.preview
    and asset.status = 'ready'
    and asset.archived_at is null
    and asset.duration_seconds > 0
    and asset.require_signed_urls;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if not internal.provider_production_validation_is_current(
    'cloudflare_stream', statement_timestamp()
  ) then
    return jsonb_build_object('status', 'provider_unavailable');
  end if;
  return jsonb_build_object(
    'status', 'authorized',
    'courseVersionId', target_course_version,
    'lessonId', target_lesson,
    'videoUid', preview_asset.provider_uid,
    'durationSeconds', preview_asset.duration_seconds
  );
end
$$;

revoke all on function internal.authorize_public_course_preview(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.authorize_public_course_preview(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  internal.authorize_public_course_preview(uuid, uuid)
  to service_role;
grant execute on function
  public.authorize_public_course_preview(uuid, uuid)
  to service_role;
