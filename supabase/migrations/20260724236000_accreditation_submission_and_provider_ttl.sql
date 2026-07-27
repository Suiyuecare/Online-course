-- Accreditation submission scope/claim isolation and provider evidence TTL.
-- Every browser mutation remains an invoker wrapper around a role-checked
-- internal function. Claims and control evidence are never table-readable by
-- API roles.

alter table public.provider_health
  add column production_validation_expires_at timestamptz;

update public.provider_health health
set production_validation_expires_at = (
  select request.tested_at + interval '90 days'
  from public.provider_validation_requests request
  where request.provider = health.provider
    and request.status = 'approved'
    and request.reviewed_at = health.production_validated_at
    and request.tested_at <= request.reviewed_at
    and request.tested_at + interval '90 days' > clock_timestamp()
  order by request.reviewed_at desc, request.id desc
  limit 1
)
where health.production_validated_at is not null;

update public.provider_health
set production_validated_at = null,
    production_validation_expires_at = null
where production_validated_at is not null
  and production_validation_expires_at is null;

alter table public.provider_health
  add constraint provider_validation_expiry_pair
  check (
    (
      production_validated_at is null
      and production_validation_expires_at is null
    )
    or (
      production_validated_at is not null
      and production_validation_expires_at
        > production_validated_at
    )
  );

alter table public.accreditation_submission_batches
  add column supersedes_batch_id uuid
    references public.accreditation_submission_batches(id),
  add column isolated_at timestamptz,
  add column isolation_reason text,
  add column isolated_by_revision_id uuid
    references public.accreditation_decision_revisions(id),
  add constraint accreditation_batch_not_self_superseding
    check (supersedes_batch_id is null or supersedes_batch_id <> id),
  add constraint accreditation_batch_isolation_coherent
    check (
      (
        isolated_at is null
        and isolation_reason is null
        and isolated_by_revision_id is null
      )
      or (
        isolated_at is not null
        and length(trim(coalesce(isolation_reason, ''))) >= 10
        and isolated_by_revision_id is not null
      )
    );

create unique index one_correction_batch_per_source
  on public.accreditation_submission_batches(supersedes_batch_id)
  where supersedes_batch_id is not null;

alter table public.eligibility_snapshots
  add column required_live_booking_ids uuid[] not null
    default '{}'::uuid[];

alter table public.accreditation_submission_items
  add column live_booking_id uuid references public.live_bookings(id),
  add constraint accreditation_submission_item_live_binding_unique
    unique (batch_id, enrollment_id, live_booking_id);

create or replace function
  internal.capture_eligibility_required_live_bookings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target_course_version uuid;
  target_delivery_type text;
  captured_booking_ids uuid[] := '{}'::uuid[];
  required_component_count integer := 0;
begin
  select version.id, version.delivery_type
  into target_course_version, target_delivery_type
  from public.enrollments enrollment
  join public.course_versions version
    on version.id = enrollment.course_version_id
  where enrollment.id = new.enrollment_id;
  if not found then
    raise exception 'ELIGIBILITY_ENROLLMENT_REQUIRED';
  end if;

  if target_delivery_type = 'live' then
    select coalesce(array_agg(booking.id order by booking.id), '{}'::uuid[])
    into captured_booking_ids
    from public.live_bookings booking
    join public.live_sessions session
      on session.id = booking.live_session_id
    join public.attendance_summaries attendance
      on attendance.live_booking_id = booking.id
    where booking.enrollment_id = new.enrollment_id
      and booking.course_version_id = target_course_version
      and booking.live_component_id is null
      and booking.status = 'attended'
      and session.course_version_id = target_course_version
      and session.hybrid_component_id is null
      and session.status = 'ended'
      and attendance.qualified
      and attendance.quarantined_at is null;
    if new.live_requirements_met
       and cardinality(captured_booking_ids) = 0
    then
      raise exception 'ELIGIBILITY_LIVE_EVIDENCE_REQUIRED';
    end if;
  elsif target_delivery_type = 'hybrid' then
    select count(*) into required_component_count
    from public.hybrid_components component
    where component.course_version_id = target_course_version
      and component.component_type = 'live'
      and component.required;

    select coalesce(
      array_agg(evidence.live_booking_id order by evidence.component_id),
      '{}'::uuid[]
    )
    into captured_booking_ids
    from (
      select
        component.id as component_id,
        qualified_booking.id as live_booking_id
      from public.hybrid_components component
      join lateral (
        select booking.id
        from public.live_bookings booking
        join public.live_sessions session
          on session.id = booking.live_session_id
        join public.attendance_summaries attendance
          on attendance.live_booking_id = booking.id
        where booking.enrollment_id = new.enrollment_id
          and booking.course_version_id = target_course_version
          and booking.live_component_id = component.id
          and booking.status = 'attended'
          and session.course_version_id = target_course_version
          and session.hybrid_component_id = component.id
          and session.status = 'ended'
          and attendance.qualified
          and attendance.quarantined_at is null
        order by booking.id
        limit 1
      ) qualified_booking on true
      where component.course_version_id = target_course_version
        and component.component_type = 'live'
        and component.required
    ) evidence;

    if new.live_requirements_met
       and cardinality(captured_booking_ids) <> required_component_count
    then
      raise exception 'ELIGIBILITY_HYBRID_EVIDENCE_INCOMPLETE';
    end if;
  end if;

  new.required_live_booking_ids := captured_booking_ids;
  new.signed_snapshot := coalesce(new.signed_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'requiredLiveBookingIds', to_jsonb(captured_booking_ids)
    );
  new.evidence_manifest_hash := encode(extensions.digest(
    new.evidence_manifest_hash || ':'
      || array_to_string(captured_booking_ids, ','),
    'sha256'
  ), 'hex');
  return new;
end
$$;
revoke all on function
  internal.capture_eligibility_required_live_bookings()
  from public, anon, authenticated, service_role;

create trigger eligibility_snapshot_captures_required_live_bookings
before insert on public.eligibility_snapshots
for each row execute function
  internal.capture_eligibility_required_live_bookings();

create table public.accreditation_submission_claims (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  enrollment_id uuid not null,
  live_booking_id uuid references public.live_bookings(id),
  accreditation_revision_id uuid not null
    references public.accreditation_decision_revisions(id),
  eligibility_snapshot_id uuid not null
    references public.eligibility_snapshots(id),
  supersedes_claim_id uuid
    references public.accreditation_submission_claims(id),
  status text not null check (status in (
    'active', 'accepted', 'needs_correction', 'rejected',
    'superseded', 'isolated'
  )),
  claimed_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  unique (batch_id, enrollment_id),
  unique (supersedes_claim_id),
  foreign key (batch_id, enrollment_id)
    references public.accreditation_submission_items(
      batch_id, enrollment_id
    ),
  foreign key (batch_id, enrollment_id, live_booking_id)
    references public.accreditation_submission_items(
      batch_id, enrollment_id, live_booking_id
    ),
  check (supersedes_claim_id is null or supersedes_claim_id <> id),
  check (
    (status = 'active' and resolved_at is null)
    or (status <> 'active' and resolved_at is not null)
  )
);

create or replace function
  internal.guard_accreditation_submission_live_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.live_booking_id is distinct from old.live_booking_id then
    raise exception 'ACCREDITATION_LIVE_BINDING_IMMUTABLE';
  end if;
  return new;
end
$$;
revoke all on function
  internal.guard_accreditation_submission_live_binding()
  from public, anon, authenticated, service_role;

create trigger accreditation_submission_item_live_binding_immutable
before update on public.accreditation_submission_items
for each row execute function
  internal.guard_accreditation_submission_live_binding();

create trigger accreditation_submission_claim_live_binding_immutable
before update on public.accreditation_submission_claims
for each row execute function
  internal.guard_accreditation_submission_live_binding();

create unique index one_active_or_accepted_submission_per_enrollment
  on public.accreditation_submission_claims(enrollment_id)
  where status in ('active', 'accepted');

create table public.accreditation_submission_claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null
    references public.accreditation_submission_claims(id),
  batch_id uuid not null
    references public.accreditation_submission_batches(id),
  previous_status text,
  next_status text not null check (next_status in (
    'active', 'accepted', 'needs_correction', 'rejected',
    'superseded', 'isolated'
  )),
  actor_person_id uuid not null references public.people(id),
  reason text not null check (length(trim(reason)) between 3 and 1000),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (claim_id, next_status, batch_id)
);

create trigger accreditation_submission_claim_events_append_only
before update or delete on public.accreditation_submission_claim_events
for each row execute function internal.prevent_append_only_change();

alter table public.accreditation_submission_claims
  enable row level security;
alter table public.accreditation_submission_claims
  force row level security;
alter table public.accreditation_submission_claim_events
  enable row level security;
alter table public.accreditation_submission_claim_events
  force row level security;

revoke all on table public.accreditation_submission_claims
  from public, anon, authenticated, service_role;
revoke all on table public.accreditation_submission_claim_events
  from public, anon, authenticated, service_role;

create or replace function internal.provider_production_validation_is_current(
  submitted_provider text,
  observed_at timestamptz default now()
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.provider_health health
    join public.provider_validation_requests request
      on request.provider = health.provider
     and request.status = 'approved'
     and request.reviewed_at = health.production_validated_at
    where health.provider = submitted_provider
      and health.status = 'healthy'
      and health.production_validated_at is not null
      and health.production_validation_expires_at > observed_at
      and request.test_environment = 'production'
      and request.tested_at <= request.reviewed_at
      and request.tested_at > observed_at - interval '90 days'
      and health.production_validation_expires_at
        = request.tested_at + interval '90 days'
  )
$$;
revoke all on function
  internal.provider_production_validation_is_current(text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function internal.accreditation_submission_scope_is_valid(
  target_course_version uuid,
  target_accreditation_revision uuid,
  target_live_session uuid,
  observed_at timestamptz default now()
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.course_versions version
    join lateral (
      select revision.*
      from public.accreditation_decision_revisions revision
      where revision.course_id = version.course_id
      order by revision.revision desc, revision.id
      limit 1
    ) latest on true
    where version.id = target_course_version
      and latest.id = target_accreditation_revision
      and latest.status = 'approved'
      and latest.effective_at <= observed_at
      and latest.valid_from <= observed_at
      and latest.valid_until > observed_at
      and exists (
        select 1
        from public.course_version_accreditation link
        where link.course_version_id = version.id
          and link.accreditation_revision_id = latest.id
      )
      and (
        (
          version.delivery_type = 'recorded'
          and target_live_session is null
        )
        or (
          version.delivery_type in ('live', 'hybrid')
          and target_live_session is not null
          and exists (
            select 1
            from public.live_sessions session
            where session.id = target_live_session
              and session.course_version_id = version.id
              and session.status = 'ended'
          )
        )
      )
  )
$$;
revoke all on function internal.accreditation_submission_scope_is_valid(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;

create or replace function
  internal.accreditation_submission_item_scope_is_valid(
    target_batch uuid,
    target_enrollment uuid,
    target_eligibility_snapshot uuid,
    target_live_booking uuid
  )
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.accreditation_submission_batches batch
    join public.course_versions version
      on version.id = batch.course_version_id
    join public.eligibility_snapshots snapshot
      on snapshot.id = target_eligibility_snapshot
     and snapshot.enrollment_id = target_enrollment
     and snapshot.accreditation_revision_id =
       batch.accreditation_revision_id
    where batch.id = target_batch
      and snapshot.eligible
      and (
        (
          version.delivery_type = 'recorded'
          and batch.live_session_id is null
          and target_live_booking is null
          and cardinality(snapshot.required_live_booking_ids) = 0
        )
        or (
          version.delivery_type in ('live', 'hybrid')
          and batch.live_session_id is not null
          and target_live_booking is not null
          and target_live_booking =
            any(snapshot.required_live_booking_ids)
          and snapshot.signed_snapshot -> 'requiredLiveBookingIds'
            = to_jsonb(snapshot.required_live_booking_ids)
          and exists (
            select 1
            from public.live_bookings booking
            join public.live_sessions session
              on session.id = booking.live_session_id
            join public.attendance_summaries attendance
              on attendance.live_booking_id = booking.id
            where booking.id = target_live_booking
              and booking.enrollment_id = target_enrollment
              and booking.course_version_id = batch.course_version_id
              and booking.live_session_id = batch.live_session_id
              and booking.status = 'attended'
              and session.course_version_id = batch.course_version_id
              and session.status = 'ended'
              and attendance.qualified
              and attendance.quarantined_at is null
              and (
                (
                  version.delivery_type = 'live'
                  and booking.live_component_id is null
                  and session.hybrid_component_id is null
                )
                or (
                  version.delivery_type = 'hybrid'
                  and booking.live_component_id is not null
                  and session.hybrid_component_id =
                    booking.live_component_id
                  and exists (
                    select 1
                    from public.hybrid_components component
                    where component.id = booking.live_component_id
                      and component.course_version_id =
                        batch.course_version_id
                      and component.component_type = 'live'
                      and component.required
                  )
                )
              )
          )
          and (
            version.delivery_type <> 'hybrid'
            or not exists (
              select 1
              from public.hybrid_components required_component
              where required_component.course_version_id =
                  batch.course_version_id
                and required_component.component_type = 'live'
                and required_component.required
                and not exists (
                  select 1
                  from unnest(snapshot.required_live_booking_ids)
                    manifest(live_booking_id)
                  join public.live_bookings manifest_booking
                    on manifest_booking.id = manifest.live_booking_id
                  join public.live_sessions manifest_session
                    on manifest_session.id =
                      manifest_booking.live_session_id
                  join public.attendance_summaries manifest_attendance
                    on manifest_attendance.live_booking_id =
                      manifest_booking.id
                  where manifest_booking.enrollment_id =
                      target_enrollment
                    and manifest_booking.course_version_id =
                      batch.course_version_id
                    and manifest_booking.live_component_id =
                      required_component.id
                    and manifest_booking.status = 'attended'
                    and manifest_session.course_version_id =
                      batch.course_version_id
                    and manifest_session.hybrid_component_id =
                      required_component.id
                    and manifest_session.status = 'ended'
                    and manifest_attendance.qualified
                    and manifest_attendance.quarantined_at is null
                )
            )
          )
        )
      )
  )
$$;
revoke all on function
  internal.accreditation_submission_item_scope_is_valid(
    uuid, uuid, uuid, uuid
  )
  from public, anon, authenticated, service_role;

create or replace function internal.lock_accreditation_submission_batch(
  target_batch uuid,
  allowed_statuses text[]
)
returns public.accreditation_submission_batches
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result public.accreditation_submission_batches%rowtype;
  target_course uuid;
begin
  select version.course_id into target_course
  from public.accreditation_submission_batches batch
  join public.course_versions version
    on version.id = batch.course_version_id
  where batch.id = target_batch;
  if target_course is null then
    raise exception 'ACCREDITATION_BATCH_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:accreditation:' || target_course::text, 0
  ));
  select * into result
  from public.accreditation_submission_batches batch
  where batch.id = target_batch
  for update;
  if result.status <> all(allowed_statuses)
     or result.isolated_at is not null
     or not internal.accreditation_submission_scope_is_valid(
       result.course_version_id,
       result.accreditation_revision_id,
       result.live_session_id,
       clock_timestamp()
     )
  then
    raise exception 'ACCREDITATION_BATCH_GATE_CLOSED';
  end if;
  return result;
end
$$;
revoke all on function internal.lock_accreditation_submission_batch(
  uuid, text[]
) from public, anon, authenticated, service_role;

create or replace function
  internal.lock_and_validate_accreditation_submission_items(
    target_batch uuid
  )
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform enrollment.id
  from public.accreditation_submission_items item
  join public.enrollments enrollment
    on enrollment.id = item.enrollment_id
  where item.batch_id = target_batch
    and item.status = 'included'
  order by enrollment.id
  for update of enrollment;

  perform certificate.id
  from public.accreditation_submission_items item
  join public.certificates certificate
    on certificate.enrollment_id = item.enrollment_id
  where item.batch_id = target_batch
    and item.status = 'included'
  order by certificate.id
  for update of certificate;

  perform session.id
  from public.accreditation_submission_batches batch
  join public.live_sessions session
    on session.id = batch.live_session_id
  where batch.id = target_batch
  order by session.id
  for share of session;

  perform booking.id
  from public.accreditation_submission_items item
  join public.live_bookings booking
    on booking.id = item.live_booking_id
  where item.batch_id = target_batch
    and item.status = 'included'
  order by booking.id
  for share of booking;

  perform attendance.id
  from public.accreditation_submission_items item
  join public.attendance_summaries attendance
    on attendance.live_booking_id = item.live_booking_id
  where item.batch_id = target_batch
    and item.status = 'included'
  order by attendance.id
  for share of attendance;

  perform claim.id
  from public.accreditation_submission_claims claim
  where claim.batch_id = target_batch
  order by claim.enrollment_id
  for update of claim;

  return not exists (
    select 1
    from public.accreditation_submission_items item
    where item.batch_id = target_batch
      and item.status = 'included'
      and not internal.accreditation_submission_item_scope_is_valid(
        item.batch_id,
        item.enrollment_id,
        item.eligibility_snapshot_id,
        item.live_booking_id
      )
  );
end
$$;
revoke all on function
  internal.lock_and_validate_accreditation_submission_items(uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.batch_has_valid_active_claims(
  target_batch uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select not exists (
    select 1
    from public.accreditation_submission_items item
    where item.batch_id = target_batch
      and item.status = 'included'
      and (
        not exists (
          select 1
          from public.accreditation_submission_claims claim
          where claim.batch_id = item.batch_id
            and claim.enrollment_id = item.enrollment_id
            and claim.eligibility_snapshot_id
              = item.eligibility_snapshot_id
            and claim.live_booking_id
              is not distinct from item.live_booking_id
            and claim.status = 'active'
        )
        or not internal.accreditation_submission_item_scope_is_valid(
          item.batch_id,
          item.enrollment_id,
          item.eligibility_snapshot_id,
          item.live_booking_id
        )
      )
  )
$$;
revoke all on function internal.batch_has_valid_active_claims(uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.isolate_batches_for_negative_accreditation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected_batch uuid;
  transition_actor uuid := coalesce(new.reviewed_by, new.created_by);
begin
  if new.status not in ('rejected', 'expired', 'revoked') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:accreditation:' || new.course_id::text, 0
  ));
  for affected_batch in
    select batch.id
    from public.accreditation_submission_batches batch
    join public.course_versions version
      on version.id = batch.course_version_id
    where version.course_id = new.course_id
      and batch.status in (
        'draft', 'approved', 'exported', 'submitted',
        'needs_correction'
      )
      and batch.isolated_at is null
    order by batch.id
    for update of batch
  loop
    insert into public.accreditation_submission_claim_events (
      claim_id, batch_id, previous_status, next_status,
      actor_person_id, reason
    )
    select
      claim.id, claim.batch_id, claim.status, 'isolated',
      transition_actor,
      'latest accreditation revision became ' || new.status
    from public.accreditation_submission_claims claim
    where claim.batch_id = affected_batch
      and claim.status in ('active', 'needs_correction')
    on conflict (claim_id, next_status, batch_id) do nothing;

    update public.accreditation_submission_claims
    set status = 'isolated',
        resolved_at = coalesce(resolved_at, clock_timestamp())
    where batch_id = affected_batch
      and status in ('active', 'needs_correction');

    update public.accreditation_submission_items
    set status = 'excluded',
        missing_reasons =
          coalesce(missing_reasons, '[]'::jsonb)
          || jsonb_build_array(
            'accreditation_' || new.status
          )
    where batch_id = affected_batch
      and status in ('included', 'needs_correction');

    update public.accreditation_submission_batches
    set isolated_at = clock_timestamp(),
        isolation_reason =
          'latest accreditation revision became ' || new.status,
        isolated_by_revision_id = new.id
    where id = affected_batch
      and isolated_at is null;
  end loop;
  if found then
    perform internal.append_audit_event(
      transition_actor,
      'accreditation.submission_batches_isolated',
      'accreditation_revision',
      new.id::text,
      'unfinished submission batches isolated before negative effects',
      null,
      jsonb_build_object(
        'courseId', new.course_id,
        'status', new.status
      )
    );
  end if;
  return new;
end
$$;
revoke all on function
  internal.isolate_batches_for_negative_accreditation()
  from public, anon, authenticated, service_role;

create trigger accreditation_negative_revision_isolates_batches
after insert on public.accreditation_decision_revisions
for each row execute function
  internal.isolate_batches_for_negative_accreditation();

create or replace function internal.enforce_provider_ttl_before_publication()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status <> 'published'
     or (tg_op = 'UPDATE' and old.status = 'published')
  then
    return new;
  end if;
  if exists (
    select 1
    from unnest(array[
      'supabase_phone_auth', 'twilio_verify', 'resend',
      'managed_kms', 'malware_scanner', 'external_monitor'
    ]) required(provider)
    where not internal.provider_production_validation_is_current(
      required.provider, clock_timestamp()
    )
  )
  then
    raise exception 'CORE_PROVIDER_VALIDATION_EXPIRED';
  end if;
  if new.delivery_type in ('recorded', 'hybrid')
     and not internal.provider_production_validation_is_current(
       'cloudflare_stream', clock_timestamp()
     )
  then
    raise exception 'STREAM_PROVIDER_VALIDATION_EXPIRED';
  end if;
  if new.delivery_type in ('live', 'hybrid')
     and (
       not internal.provider_production_validation_is_current(
         'zoom_oauth', clock_timestamp()
       )
       or not internal.provider_production_validation_is_current(
         'zoom_meeting_sdk', clock_timestamp()
       )
     )
  then
    raise exception 'LIVE_PROVIDER_VALIDATION_EXPIRED';
  end if;
  return new;
end
$$;
revoke all on function internal.enforce_provider_ttl_before_publication()
  from public, anon, authenticated, service_role;

create trigger course_publication_requires_current_provider_validation
before insert or update of status on public.course_versions
for each row execute function
  internal.enforce_provider_ttl_before_publication();

drop trigger provider_validation_dual_control
  on public.provider_health;

create or replace function internal.enforce_provider_validation_approval()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (
       new.production_validated_at
         is distinct from old.production_validated_at
       or new.production_validation_expires_at
         is distinct from old.production_validation_expires_at
     )
     and not (
       new.production_validated_at is null
       and new.production_validation_expires_at is null
     )
     and not exists (
       select 1
       from public.provider_validation_requests request
       where request.provider = new.provider
         and request.status = 'approved'
         and request.reviewed_at = new.production_validated_at
         and request.tested_at + interval '90 days'
           = new.production_validation_expires_at
     )
  then raise exception 'PROVIDER_VALIDATION_DUAL_CONTROL_REQUIRED'; end if;
  return new;
end
$$;
revoke all on function internal.enforce_provider_validation_approval()
  from public;

create trigger provider_validation_dual_control
before update of
  production_validated_at,
  production_validation_expires_at
on public.provider_health
for each row execute function internal.enforce_provider_validation_approval();

create or replace function internal.decide_provider_validation(
  target_request uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  request_row public.provider_validation_requests%rowtype;
  decision_at timestamptz := clock_timestamp();
  expires_at timestamptz;
begin
  perform internal.consume_step_up_grant(
    'platform_prerequisite_review',
    target_request::text,
    submitted_nonce_hash
  );
  if not internal.has_staff_role('platform_admin')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'PROVIDER_VALIDATION_DECISION_REJECTED'; end if;
  select * into request_row
  from public.provider_validation_requests request
  where request.id = target_request
  for update;
  if not found
     or request_row.status <> 'pending_review'
     or request_row.requested_by = actor
  then raise exception 'DISTINCT_PROVIDER_VALIDATION_REVIEWER_REQUIRED'; end if;
  if submitted_decision = 'approve'
     and (
       request_row.tested_at > decision_at
       or request_row.tested_at
         <= decision_at - interval '90 days'
       or not exists (
         select 1
         from public.provider_health health
         where health.provider = request_row.provider
           and health.status = 'healthy'
           and health.checked_at
             >= decision_at - interval '15 minutes'
           and health.last_success_at is not null
       )
     )
  then raise exception 'PROVIDER_EVIDENCE_EXPIRED_OR_UNHEALTHY'; end if;

  expires_at := request_row.tested_at + interval '90 days';
  update public.provider_validation_requests
  set status = case submitted_decision
        when 'approve' then 'approved' else 'rejected' end,
      reviewed_by = actor,
      review_reason = trim(submitted_reason),
      reviewed_at = decision_at
  where id = target_request;
  if submitted_decision = 'approve' then
    update public.provider_health
    set production_validated_at = decision_at,
        production_validation_expires_at = expires_at,
        updated_at = decision_at
    where provider = request_row.provider;
  end if;
  perform internal.append_audit_event(
    actor,
    'provider.production_validation_' || case submitted_decision
      when 'approve' then 'approved' else 'rejected' end,
    'provider_validation_request', target_request::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'provider', request_row.provider,
      'evidenceSha256', request_row.evidence_sha256,
      'testedAt', request_row.tested_at,
      'validationExpiresAt', case submitted_decision
        when 'approve' then expires_at else null end
    )
  );
  return jsonb_build_object(
    'requestId', target_request,
    'status', case submitted_decision
      when 'approve' then 'approved' else 'rejected' end,
    'productionValidatedAt', case submitted_decision
      when 'approve' then decision_at else null end,
    'productionValidationExpiresAt', case submitted_decision
      when 'approve' then expires_at else null end
  );
end
$$;
revoke all on function internal.decide_provider_validation(
  uuid, text, text, text
) from public;

create or replace function internal.create_accreditation_submission_batch(
  target_course_version uuid,
  target_accreditation_revision uuid,
  target_live_session uuid,
  submitted_template_version text,
  target_supersedes_batch uuid,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  batch_id uuid;
  version_row public.course_versions%rowtype;
  prior_batch public.accreditation_submission_batches%rowtype;
  existing_batch public.accreditation_submission_batches%rowtype;
begin
  if not internal.has_staff_role('course_admin')
     or length(trim(submitted_template_version)) not between 1 and 100
  then
    raise exception 'ACCREDITATION_BATCH_REJECTED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:accreditation-batch-idempotency:' || idempotency::text, 0
  ));
  select * into existing_batch
  from public.accreditation_submission_batches batch
  where batch.application_idempotency_key = idempotency;
  if found then
    if existing_batch.requested_by <> actor
       or existing_batch.course_version_id <> target_course_version
       or existing_batch.accreditation_revision_id
         <> target_accreditation_revision
       or existing_batch.live_session_id
         is distinct from target_live_session
       or existing_batch.supersedes_batch_id
         is distinct from target_supersedes_batch
       or existing_batch.template_version
         <> trim(submitted_template_version)
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return existing_batch.id;
  end if;

  select * into version_row
  from public.course_versions version
  where version.id = target_course_version;
  if not found then raise exception 'ACCREDITATION_BATCH_REJECTED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:accreditation:' || version_row.course_id::text, 0
  ));
  select * into existing_batch
  from public.accreditation_submission_batches batch
  where batch.application_idempotency_key = idempotency
  for update;
  if found then
    if existing_batch.requested_by <> actor
       or existing_batch.course_version_id <> target_course_version
       or existing_batch.accreditation_revision_id
         <> target_accreditation_revision
       or existing_batch.live_session_id
         is distinct from target_live_session
       or existing_batch.supersedes_batch_id
         is distinct from target_supersedes_batch
       or existing_batch.template_version
         <> trim(submitted_template_version)
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return existing_batch.id;
  end if;
  select * into version_row
  from public.course_versions version
  where version.id = target_course_version
    and version.status = 'published'
  for share;
  if not found
     or not internal.accreditation_submission_scope_is_valid(
       target_course_version,
       target_accreditation_revision,
       target_live_session,
       clock_timestamp()
     )
  then raise exception 'ACCREDITATION_BATCH_SCOPE_INVALID'; end if;

  if target_supersedes_batch is not null then
    select * into prior_batch
    from public.accreditation_submission_batches batch
    where batch.id = target_supersedes_batch
    for update;
    if not found
       or prior_batch.status <> 'needs_correction'
       or prior_batch.isolated_at is not null
       or prior_batch.course_version_id <> target_course_version
       or prior_batch.accreditation_revision_id
         <> target_accreditation_revision
       or prior_batch.live_session_id
         is distinct from target_live_session
       or exists (
         select 1
         from public.accreditation_submission_batches child
         where child.supersedes_batch_id = target_supersedes_batch
       )
    then
      raise exception 'ACCREDITATION_CORRECTION_LINEAGE_INVALID';
    end if;
  end if;

  insert into public.accreditation_submission_batches (
    course_version_id, accreditation_revision_id, live_session_id,
    template_version, application_idempotency_key, requested_by,
    supersedes_batch_id
  ) values (
    target_course_version, target_accreditation_revision,
    target_live_session, trim(submitted_template_version),
    idempotency, actor, target_supersedes_batch
  ) returning id into batch_id;

  insert into public.accreditation_submission_items (
    batch_id, enrollment_id, eligibility_snapshot_id,
    live_booking_id, status, missing_reasons
  )
  select
    batch_id,
    enrollment.id,
    snapshot.id,
    target_booking.id,
    case
      when coalesce(snapshot.eligible, false)
        and (
          (
            target_supersedes_batch is null
            and enrollment.status = 'completed'
            and not exists (
              select 1
              from public.accreditation_submission_claims prior_claim
              where prior_claim.enrollment_id = enrollment.id
                and prior_claim.status in (
                  'active', 'accepted', 'needs_correction', 'rejected'
                )
            )
            and not exists (
              select 1
              from public.accreditation_submission_items prior_item
              where prior_item.enrollment_id = enrollment.id
                and prior_item.status = 'accepted'
            )
          )
          or (
            target_supersedes_batch is not null
            and enrollment.status = 'needs_correction'
            and exists (
              select 1
              from public.accreditation_submission_items prior_item
              join public.accreditation_submission_claims prior_claim
                on prior_claim.batch_id = prior_item.batch_id
               and prior_claim.enrollment_id = prior_item.enrollment_id
              where prior_item.batch_id = target_supersedes_batch
                and prior_item.enrollment_id = enrollment.id
                and prior_item.status = 'needs_correction'
                and prior_claim.status = 'needs_correction'
                and prior_item.live_booking_id
                  is not distinct from target_booking.id
                and prior_claim.live_booking_id
                  is not distinct from target_booking.id
            )
            and not exists (
              select 1
              from public.accreditation_submission_claims competing_claim
              where competing_claim.enrollment_id = enrollment.id
                and competing_claim.status in ('active', 'accepted')
            )
          )
        )
        and not exists (
          select 1
          from public.certificates certificate
          where certificate.enrollment_id = enrollment.id
            and certificate.current_status in ('credited', 'revoked')
        )
        and exists (
          select 1
          from public.certificates certificate
          where certificate.enrollment_id = enrollment.id
            and certificate.current_status in (
              'active', 'needs_correction'
            )
        )
      then 'included'
      else 'excluded'
    end,
    to_jsonb(array_remove(array[
      case when snapshot.id is null
        then 'eligibility_snapshot_missing' end,
      case when snapshot.id is not null and not snapshot.entitlement_valid
        then 'entitlement_invalid' end,
      case when snapshot.id is not null and not snapshot.identity_verified
        then 'identity_unverified' end,
      case when snapshot.id is not null
        and not snapshot.recorded_requirement_met
        then 'recorded_requirement_missing' end,
      case when snapshot.id is not null
        and not snapshot.live_requirements_met
        then 'live_requirement_missing' end,
      case when snapshot.id is not null and not snapshot.quiz_passed
        then 'quiz_not_passed' end,
      case when snapshot.id is not null and not snapshot.survey_completed
        then 'survey_missing' end,
      case when snapshot.id is not null and not snapshot.accreditation_valid
        then 'accreditation_invalid' end,
      case
        when target_supersedes_batch is null
          and enrollment.status <> 'completed'
        then 'enrollment_not_completed'
      end,
      case
        when target_supersedes_batch is not null
          and enrollment.status <> 'needs_correction'
        then 'enrollment_not_waiting_for_correction'
      end,
      case when exists (
        select 1
        from public.accreditation_submission_claims prior_claim
        where prior_claim.enrollment_id = enrollment.id
          and prior_claim.status = 'active'
      ) then 'active_submission_claim_exists' end,
      case when enrollment.status = 'credited'
        or exists (
          select 1
          from public.accreditation_submission_claims prior_claim
          where prior_claim.enrollment_id = enrollment.id
            and prior_claim.status = 'accepted'
        )
        or exists (
          select 1
          from public.accreditation_submission_items prior_item
          where prior_item.enrollment_id = enrollment.id
            and prior_item.status = 'accepted'
        )
      then 'already_credited_or_accepted' end,
      case
        when target_supersedes_batch is null
          and exists (
            select 1
            from public.accreditation_submission_claims prior_claim
            where prior_claim.enrollment_id = enrollment.id
              and prior_claim.status in ('needs_correction', 'rejected')
          )
        then 'prior_submission_requires_lineage'
      end,
      case
        when target_supersedes_batch is not null
          and not exists (
            select 1
            from public.accreditation_submission_items prior_item
            join public.accreditation_submission_claims prior_claim
              on prior_claim.batch_id = prior_item.batch_id
             and prior_claim.enrollment_id = prior_item.enrollment_id
            where prior_item.batch_id = target_supersedes_batch
              and prior_item.enrollment_id = enrollment.id
              and prior_item.status = 'needs_correction'
              and prior_claim.status = 'needs_correction'
              and prior_item.live_booking_id
                is not distinct from target_booking.id
              and prior_claim.live_booking_id
                is not distinct from target_booking.id
          )
        then 'correction_lineage_missing'
      end,
      case when exists (
        select 1
        from public.certificates certificate
        where certificate.enrollment_id = enrollment.id
          and certificate.current_status = 'revoked'
      ) then 'certificate_revoked' end,
      case when not exists (
        select 1
        from public.certificates certificate
        where certificate.enrollment_id = enrollment.id
          and certificate.current_status in (
            'active', 'needs_correction'
          )
      ) then 'certificate_not_submittable' end,
      case when target_live_session is not null
        and target_booking.id is null
        then 'target_live_booking_not_qualified' end
    ], null))
  from public.enrollments enrollment
  left join lateral (
    select eligibility.*
    from public.eligibility_snapshots eligibility
    where eligibility.enrollment_id = enrollment.id
      and eligibility.accreditation_revision_id =
        target_accreditation_revision
    order by eligibility.created_at desc, eligibility.id desc
    limit 1
  ) snapshot on true
  left join lateral (
    select booking.id
    from public.live_bookings booking
    join public.live_sessions session
      on session.id = booking.live_session_id
    join public.attendance_summaries attendance
      on attendance.live_booking_id = booking.id
    where booking.enrollment_id = enrollment.id
      and booking.course_version_id = target_course_version
      and booking.live_session_id = target_live_session
      and booking.status = 'attended'
      and session.course_version_id = target_course_version
      and session.status = 'ended'
      and attendance.qualified
      and attendance.quarantined_at is null
      and booking.id = any(coalesce(
        snapshot.required_live_booking_ids, '{}'::uuid[]
      ))
      and (
        (
          version_row.delivery_type = 'live'
          and booking.live_component_id is null
          and session.hybrid_component_id is null
        )
        or (
          version_row.delivery_type = 'hybrid'
          and booking.live_component_id is not null
          and session.hybrid_component_id = booking.live_component_id
          and exists (
            select 1
            from public.hybrid_components component
            where component.id = booking.live_component_id
              and component.course_version_id = target_course_version
              and component.component_type = 'live'
              and component.required
          )
        )
      )
    order by booking.id
    limit 1
  ) target_booking on target_live_session is not null
  where enrollment.course_version_id = target_course_version
    and (
      target_live_session is null
      or target_booking.id is not null
    )
    and (
      target_supersedes_batch is null
      or exists (
        select 1
        from public.accreditation_submission_items prior_item
        where prior_item.batch_id = target_supersedes_batch
          and prior_item.enrollment_id = enrollment.id
          and prior_item.status = 'needs_correction'
      )
    );

  if not internal.lock_and_validate_accreditation_submission_items(batch_id)
  then
    raise exception 'ACCREDITATION_BATCH_ITEM_SCOPE_INVALID';
  end if;

  if target_supersedes_batch is not null then
    perform claim.id
    from public.accreditation_submission_claims claim
    join public.accreditation_submission_items item
      on item.enrollment_id = claim.enrollment_id
     and item.batch_id = batch_id
     and item.status = 'included'
    where claim.batch_id = target_supersedes_batch
      and claim.status = 'needs_correction'
    order by claim.enrollment_id
    for update of claim;
    if exists (
      select 1
      from public.accreditation_submission_items item
      where item.batch_id = batch_id
        and item.status = 'included'
        and not exists (
          select 1
          from public.accreditation_submission_claims claim
          where claim.batch_id = target_supersedes_batch
            and claim.enrollment_id = item.enrollment_id
            and claim.status = 'needs_correction'
            and claim.live_booking_id
              is not distinct from item.live_booking_id
        )
    ) then
      raise exception 'ACCREDITATION_CORRECTION_CLAIM_MISSING';
    end if;
    insert into public.accreditation_submission_claim_events (
      claim_id, batch_id, previous_status, next_status,
      actor_person_id, reason
    )
    select
      claim.id, claim.batch_id, 'needs_correction', 'superseded',
      actor, 'correction batch superseded the prior claim'
    from public.accreditation_submission_claims claim
    join public.accreditation_submission_items item
      on item.enrollment_id = claim.enrollment_id
     and item.batch_id = batch_id
     and item.status = 'included'
    where claim.batch_id = target_supersedes_batch
      and claim.status = 'needs_correction';
    update public.accreditation_submission_claims claim
    set status = 'superseded',
        resolved_at = coalesce(resolved_at, clock_timestamp())
    where claim.batch_id = target_supersedes_batch
      and claim.status = 'needs_correction'
      and exists (
        select 1
        from public.accreditation_submission_items item
        where item.batch_id = batch_id
          and item.enrollment_id = claim.enrollment_id
          and item.status = 'included'
          and item.live_booking_id
            is not distinct from claim.live_booking_id
      );
  end if;

  insert into public.accreditation_submission_claims (
    batch_id, enrollment_id, accreditation_revision_id,
    eligibility_snapshot_id, live_booking_id,
    supersedes_claim_id, status
  )
  select
    item.batch_id, item.enrollment_id, target_accreditation_revision,
    item.eligibility_snapshot_id, item.live_booking_id,
    case when target_supersedes_batch is null then null else (
      select claim.id
      from public.accreditation_submission_claims claim
      where claim.batch_id = target_supersedes_batch
        and claim.enrollment_id = item.enrollment_id
        and claim.status = 'superseded'
        and claim.live_booking_id
          is not distinct from item.live_booking_id
    ) end,
    'active'
  from public.accreditation_submission_items item
  where item.batch_id = batch_id
    and item.status = 'included'
    and item.eligibility_snapshot_id is not null;

  insert into public.accreditation_submission_claim_events (
    claim_id, batch_id, previous_status, next_status,
    actor_person_id, reason
  )
  select
    claim.id, claim.batch_id, null, 'active',
    actor, case when target_supersedes_batch is null
      then 'eligibility snapshot claimed for a new submission'
      else 'eligibility snapshot claimed for correction resubmission'
    end
  from public.accreditation_submission_claims claim
  where claim.batch_id = batch_id;

  perform internal.append_audit_event(
    actor, 'accreditation.batch_created', 'submission_batch',
    batch_id::text, case when target_supersedes_batch is null
      then 'eligibility preview and active claims created'
      else 'correction lineage and active claims created'
    end,
    null,
    jsonb_build_object(
      'courseVersionId', target_course_version,
      'liveSessionId', target_live_session,
      'supersedesBatchId', target_supersedes_batch,
      'activeClaimCount', (
        select count(*)
        from public.accreditation_submission_claims claim
        where claim.batch_id = batch_id
          and claim.status = 'active'
      )
    )
  );
  return batch_id;
end
$$;
revoke all on function internal.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid, uuid
) from public;

create or replace function public.create_accreditation_submission_batch(
  p_course_version_id uuid,
  p_accreditation_revision_id uuid,
  p_live_session_id uuid,
  p_template_version text,
  p_supersedes_batch_id uuid,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_accreditation_submission_batch(
    p_course_version_id, p_accreditation_revision_id,
    p_live_session_id, p_template_version,
    p_supersedes_batch_id, p_idempotency_key
  )
$$;

revoke all on function internal.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid, uuid
) from public, anon;
grant execute on function internal.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid, uuid
) to authenticated;
grant execute on function public.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid, uuid
) to authenticated;

create or replace function internal.approve_and_authorize_export(
  target_batch uuid,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  batch_row public.accreditation_submission_batches%rowtype;
  included_count integer;
begin
  perform internal.consume_step_up_grant(
    'accreditation_export', target_batch::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer') then
    raise exception 'ACCREDITATION_REVIEWER_REQUIRED';
  end if;
  batch_row := internal.lock_accreditation_submission_batch(
    target_batch, array['draft', 'approved']
  );
  if batch_row.requested_by = actor then
    raise exception 'DISTINCT_EXPORT_APPROVER_REQUIRED';
  end if;

  if not internal.lock_and_validate_accreditation_submission_items(
    target_batch
  ) then
    raise exception 'ACCREDITATION_BATCH_ITEM_SCOPE_INVALID';
  end if;

  if not internal.batch_has_valid_active_claims(target_batch)
     or exists (
       select 1
       from public.accreditation_submission_items item
       join public.enrollments enrollment
         on enrollment.id = item.enrollment_id
       left join public.certificates certificate
         on certificate.enrollment_id = enrollment.id
       where item.batch_id = target_batch
         and item.status = 'included'
         and (
           enrollment.status not in ('completed', 'needs_correction')
           or certificate.id is null
           or certificate.current_status in ('credited', 'revoked')
         )
     )
  then raise exception 'ACCREDITATION_CLAIM_STATE_INVALID'; end if;

  select count(*) into included_count
  from public.accreditation_submission_items item
  join public.eligibility_snapshots snapshot
    on snapshot.id = item.eligibility_snapshot_id
  join public.accreditation_submission_claims claim
    on claim.batch_id = item.batch_id
   and claim.enrollment_id = item.enrollment_id
   and claim.eligibility_snapshot_id = snapshot.id
   and claim.live_booking_id
     is not distinct from item.live_booking_id
   and claim.status = 'active'
  where item.batch_id = target_batch
    and item.status = 'included'
    and snapshot.eligible;
  if included_count = 0 then
    raise exception 'EXPORT_HAS_NO_ELIGIBLE_ROWS';
  end if;

  update public.accreditation_submission_batches
  set status = 'approved',
      approved_by = coalesce(approved_by, actor)
  where id = target_batch
    and isolated_at is null
    and (approved_by is null or approved_by = actor);
  if not found then raise exception 'EXPORT_APPROVER_MISMATCH'; end if;
  perform internal.append_audit_event(
    actor, 'accreditation.export_authorized', 'submission_batch',
    target_batch::text,
    'fresh TOTP, current accreditation, scope, and claims approved',
    null,
    jsonb_build_object(
      'rowCount', included_count,
      'supersedesBatchId', batch_row.supersedes_batch_id
    )
  );
  return jsonb_build_object(
    'actorId', actor,
    'rowCount', included_count,
    'courseVersionId', batch_row.course_version_id,
    'accreditationRevisionId', batch_row.accreditation_revision_id,
    'liveSessionId', batch_row.live_session_id,
    'templateVersion', batch_row.template_version
  );
end
$$;
revoke all on function internal.approve_and_authorize_export(
  uuid, text
) from public;

create or replace function internal.record_accreditation_export(
  target_batch uuid,
  target_actor uuid,
  submitted_object_path text,
  submitted_sha256 text,
  submitted_envelope_key jsonb,
  submitted_row_count integer,
  submitted_filter jsonb,
  submitted_capability_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  export_id uuid;
  batch_row public.accreditation_submission_batches%rowtype;
  authoritative_row_count integer;
begin
  if auth.role() <> 'service_role'
     or submitted_object_path = ''
     or submitted_sha256 !~ '^[a-f0-9]{64}$'
     or submitted_capability_hash !~ '^[a-f0-9]{64}$'
     or submitted_row_count <= 0
  then
    raise exception 'EXPORT_RECORD_REJECTED';
  end if;
  batch_row := internal.lock_accreditation_submission_batch(
    target_batch, array['approved']
  );
  if batch_row.approved_by is distinct from target_actor then
    raise exception 'EXPORT_RECORD_REJECTED';
  end if;
  if not internal.lock_and_validate_accreditation_submission_items(
    target_batch
  ) or not internal.batch_has_valid_active_claims(target_batch)
  then raise exception 'EXPORT_RECORD_REJECTED'; end if;
  if exists (
    select 1
    from public.accreditation_submission_items item
    join public.enrollments enrollment
      on enrollment.id = item.enrollment_id
    left join public.certificates certificate
      on certificate.enrollment_id = enrollment.id
    where item.batch_id = target_batch
      and item.status = 'included'
      and (
        enrollment.status not in ('completed', 'needs_correction')
        or certificate.id is null
        or certificate.current_status in ('credited', 'revoked')
      )
  ) then raise exception 'EXPORT_RECORD_REJECTED'; end if;

  select count(*) into authoritative_row_count
  from public.accreditation_submission_items item
  join public.accreditation_submission_claims claim
   on claim.batch_id = item.batch_id
   and claim.enrollment_id = item.enrollment_id
   and claim.live_booking_id
     is not distinct from item.live_booking_id
   and claim.status = 'active'
  where item.batch_id = target_batch
    and item.status = 'included';
  if authoritative_row_count <> submitted_row_count then
    raise exception 'EXPORT_ROW_COUNT_MISMATCH';
  end if;

  insert into private.accreditation_exports (
    batch_id, encrypted_object_path, object_sha256, envelope_key,
    row_count, filter_snapshot, generated_by
  ) values (
    target_batch, submitted_object_path, submitted_sha256,
    submitted_envelope_key, submitted_row_count, submitted_filter,
    target_actor
  ) returning id into export_id;
  insert into private.export_download_capabilities (
    export_id, actor_id, token_hash, expires_at
  ) values (
    export_id, target_actor, submitted_capability_hash,
    now() + interval '10 minutes'
  );
  update public.accreditation_submission_batches
  set status = 'exported'
  where id = target_batch
    and status = 'approved'
    and isolated_at is null;
  if not found then raise exception 'EXPORT_RECORD_REJECTED'; end if;
  perform internal.append_audit_event(
    target_actor, 'accreditation.export_generated',
    'accreditation_export', export_id::text,
    'encrypted export generated from active submission claims',
    null,
    jsonb_build_object(
      'batchId', target_batch,
      'rowCount', submitted_row_count,
      'sha256', submitted_sha256
    )
  );
  return jsonb_build_object('exportId', export_id);
end
$$;
revoke all on function internal.record_accreditation_export(
  uuid, uuid, text, text, jsonb, integer, jsonb, text
) from public;

create or replace function internal.mark_accreditation_batch_submitted(
  target_batch uuid,
  submitted_external_reference text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  batch_row public.accreditation_submission_batches%rowtype;
begin
  perform internal.consume_step_up_grant(
    'accreditation_result', target_batch::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or length(trim(submitted_external_reference)) < 3
     or length(trim(submitted_reason)) < 10
  then raise exception 'ACCREDITATION_SUBMISSION_REJECTED'; end if;

  batch_row := internal.lock_accreditation_submission_batch(
    target_batch, array['exported']
  );
  if batch_row.requested_by = actor then
    raise exception 'EXPORTED_BATCH_REQUIRED';
  end if;
  if not internal.lock_and_validate_accreditation_submission_items(
    target_batch
  ) or not internal.batch_has_valid_active_claims(target_batch)
  then raise exception 'EXPORTED_BATCH_REQUIRED'; end if;
  if exists (
    select 1
    from public.accreditation_submission_items item
    join public.enrollments enrollment
      on enrollment.id = item.enrollment_id
    left join public.certificates certificate
      on certificate.enrollment_id = enrollment.id
    where item.batch_id = target_batch
      and item.status = 'included'
      and (
        enrollment.status not in ('completed', 'needs_correction')
        or certificate.id is null
        or certificate.current_status in ('credited', 'revoked')
      )
  ) then raise exception 'ACCREDITATION_SUBMISSION_STATE_INVALID'; end if;

  update public.accreditation_submission_batches
  set status = 'submitted',
      submitted_by = actor,
      external_submission_reference =
        trim(submitted_external_reference),
      submitted_at = clock_timestamp()
  where id = target_batch
    and status = 'exported'
    and isolated_at is null;
  if not found then raise exception 'EXPORTED_BATCH_REQUIRED'; end if;

  update public.enrollments enrollment
  set status = 'submitted',
      submitted_at = clock_timestamp()
  from public.accreditation_submission_items item
  where item.batch_id = target_batch
    and item.enrollment_id = enrollment.id
    and item.status = 'included'
    and enrollment.status in ('completed', 'needs_correction');
  update public.certificates certificate
  set current_status = 'submitted'
  from public.accreditation_submission_items item
  where item.batch_id = target_batch
    and item.enrollment_id = certificate.enrollment_id
    and item.status = 'included'
    and certificate.current_status in ('active', 'needs_correction');

  perform internal.append_audit_event(
    actor, 'accreditation.batch_submitted', 'submission_batch',
    target_batch::text, trim(submitted_reason), null,
    jsonb_build_object(
      'externalReference', trim(submitted_external_reference),
      'supersedesBatchId', batch_row.supersedes_batch_id
    )
  );
  return 'submitted';
end
$$;
revoke all on function internal.mark_accreditation_batch_submitted(
  uuid, text, text, text
) from public;

create or replace function internal.record_accreditation_batch_results(
  target_batch uuid,
  submitted_items jsonb,
  submitted_reason text,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  batch_row public.accreditation_submission_batches%rowtype;
  item jsonb;
  target_enrollment uuid;
  target_status text;
  item_reason text;
  target_claim public.accreditation_submission_claims%rowtype;
  claim_found boolean;
  processed integer := 0;
  next_batch_status text;
begin
  perform internal.consume_step_up_grant(
    'accreditation_result', target_batch::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or jsonb_typeof(submitted_items) <> 'array'
     or jsonb_array_length(submitted_items) not between 1 and 1000
     or length(trim(submitted_reason)) < 10
     or (
       select count(*)
       from (
         select distinct value ->> 'enrollmentId'
         from jsonb_array_elements(submitted_items)
       ) distinct_items
     ) <> jsonb_array_length(submitted_items)
  then raise exception 'ACCREDITATION_RESULT_REJECTED'; end if;

  batch_row := internal.lock_accreditation_submission_batch(
    target_batch, array['submitted']
  );
  if batch_row.submitted_by is null
     or batch_row.submitted_by = actor
     or batch_row.requested_by = actor
  then raise exception 'DISTINCT_RESULT_REVIEWER_REQUIRED'; end if;
  if not internal.lock_and_validate_accreditation_submission_items(
    target_batch
  ) or not internal.batch_has_valid_active_claims(target_batch)
  then raise exception 'ACCREDITATION_RESULT_SCOPE_INVALID'; end if;

  for item in
    select value from jsonb_array_elements(submitted_items)
  loop
    target_enrollment := (item ->> 'enrollmentId')::uuid;
    target_status := item ->> 'status';
    item_reason := trim(coalesce(item ->> 'reason', ''));

    select * into target_claim
    from public.accreditation_submission_claims claim
    where claim.batch_id = target_batch
      and claim.enrollment_id = target_enrollment
    for update;
    claim_found := found;
    if target_status not in (
         'accepted', 'needs_correction', 'rejected'
       )
       or length(item_reason) < 3
       or not claim_found
       or target_claim.status <> 'active'
       or not exists (
         select 1
         from public.accreditation_submission_items batch_item
         where batch_item.batch_id = target_batch
           and batch_item.enrollment_id = target_enrollment
           and batch_item.eligibility_snapshot_id
             = target_claim.eligibility_snapshot_id
           and batch_item.live_booking_id
             is not distinct from target_claim.live_booking_id
           and batch_item.status = 'included'
       )
       or not exists (
         select 1
         from public.enrollments enrollment
         where enrollment.id = target_enrollment
           and enrollment.status = 'submitted'
       )
       or not exists (
         select 1
         from public.certificates certificate
         where certificate.enrollment_id = target_enrollment
           and certificate.current_status = 'submitted'
       )
       or (
         target_status = 'accepted'
         and exists (
           select 1
           from public.certificates certificate
           where certificate.enrollment_id = target_enrollment
             and certificate.current_status = 'revoked'
         )
       )
    then raise exception 'ACCREDITATION_RESULT_ITEM_INVALID'; end if;

    update public.accreditation_submission_items
    set status = target_status,
        missing_reasons = case
          when target_status = 'accepted' then '[]'::jsonb
          else jsonb_build_array(item_reason)
        end
    where batch_id = target_batch
      and enrollment_id = target_enrollment
      and status = 'included';
    update public.accreditation_submission_claims
    set status = target_status,
        resolved_at = clock_timestamp()
    where id = target_claim.id
      and status = 'active';
    if not found then
      raise exception 'ACCREDITATION_CLAIM_STATE_INVALID';
    end if;
    insert into public.accreditation_submission_claim_events (
      claim_id, batch_id, previous_status, next_status,
      actor_person_id, reason
    ) values (
      target_claim.id, target_batch, 'active', target_status,
      actor, item_reason
    );

    update public.enrollments
    set status = case target_status
          when 'accepted' then 'credited'
          else target_status
        end,
        credited_at = case when target_status = 'accepted'
          then clock_timestamp() else credited_at end
    where id = target_enrollment
      and status = 'submitted';
    if target_status = 'accepted' and not found then
      raise exception 'ACCREDITATION_RESULT_ITEM_INVALID';
    end if;
    update public.certificates
    set current_status = case target_status
          when 'accepted' then 'credited'
          else target_status
        end
    where enrollment_id = target_enrollment
      and current_status = 'submitted';
    if target_status = 'accepted' and not found then
      raise exception 'ACCREDITATION_RESULT_ITEM_INVALID';
    end if;

    insert into public.notifications (
      person_id, category, title, body, business_key
    )
    select
      enrollment.person_id, 'accreditation_result',
      case target_status
        when 'accepted' then '積分登錄已確認'
        when 'needs_correction' then '積分資料需要補正'
        else '積分登錄未通過'
      end,
      case target_status
        when 'accepted' then '認可單位已確認本次積分登錄。'
        else item_reason
      end,
      'accreditation-result:' || target_batch::text || ':'
        || target_enrollment::text
    from public.enrollments enrollment
    where enrollment.id = target_enrollment
      and (
        target_status <> 'accepted'
        or (
          enrollment.status = 'credited'
          and exists (
            select 1
            from public.certificates certificate
            where certificate.enrollment_id = enrollment.id
              and certificate.current_status = 'credited'
          )
        )
      )
      and not exists (
        select 1
        from public.certificates certificate
        where certificate.enrollment_id = enrollment.id
          and certificate.current_status = 'revoked'
      )
    on conflict (person_id, business_key) do nothing;
    insert into public.notification_outbox (
      notification_id, channel, destination_ciphertext,
      template_key, template_data, business_idempotency_key
    )
    select
      notification.id, 'email', '{}'::jsonb, 'accreditation_result',
      jsonb_build_object(
        'batchId', target_batch,
        'enrollmentId', target_enrollment,
        'status', target_status
      ),
      'accreditation-result-email:' || target_batch::text || ':'
        || target_enrollment::text
    from public.notifications notification
    join public.enrollments enrollment
      on enrollment.person_id = notification.person_id
    join public.people person on person.id = enrollment.person_id
    where enrollment.id = target_enrollment
      and notification.business_key =
        'accreditation-result:' || target_batch::text || ':'
          || target_enrollment::text
      and person.email_verified_at is not null
      and (
        target_status <> 'accepted'
        or (
          enrollment.status = 'credited'
          and exists (
            select 1
            from public.certificates certificate
            where certificate.enrollment_id = enrollment.id
              and certificate.current_status = 'credited'
          )
        )
      )
      and not exists (
        select 1
        from public.certificates certificate
        where certificate.enrollment_id = enrollment.id
          and certificate.current_status = 'revoked'
      )
    on conflict (business_idempotency_key) do nothing;
    processed := processed + 1;
  end loop;

  select case
    when exists (
      select 1
      from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status = 'included'
    ) then 'submitted'
    when exists (
      select 1
      from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status = 'needs_correction'
    ) then 'needs_correction'
    when exists (
      select 1
      from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status = 'rejected'
    )
    and exists (
      select 1
      from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status = 'accepted'
    ) then 'needs_correction'
    when exists (
      select 1
      from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status = 'rejected'
    ) then 'rejected'
    when exists (
      select 1
      from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status = 'accepted'
    ) then 'accepted'
    else 'rejected'
  end into next_batch_status;
  update public.accreditation_submission_batches
  set status = next_batch_status
  where id = target_batch
    and isolated_at is null;
  if not found then
    raise exception 'ACCREDITATION_BATCH_GATE_CLOSED';
  end if;
  perform internal.append_audit_event(
    actor, 'accreditation.results_recorded', 'submission_batch',
    target_batch::text, trim(submitted_reason), null,
    jsonb_build_object(
      'processed', processed,
      'batchStatus', next_batch_status,
      'supersedesBatchId', batch_row.supersedes_batch_id
    )
  );
  return jsonb_build_object(
    'processed', processed,
    'batchStatus', next_batch_status
  );
end
$$;
revoke all on function internal.record_accreditation_batch_results(
  uuid, jsonb, text, text
) from public;

create or replace function internal.read_public_course_readiness(
  target_version uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  version_row public.course_versions%rowtype;
  reasons jsonb := '[]'::jsonb;
begin
  select * into version_row
  from public.course_versions version
  where version.id = target_version;
  if not found
     or version_row.status <> 'published'
     or version_row.commerce_close_at <= now()
  then
    return jsonb_build_object(
      'purchaseReady', false,
      'reasons', jsonb_build_array('此課程目前未開放報名。')
    );
  end if;
  if not internal.feature_is_open('b2c_commerce') then
    reasons := reasons || jsonb_build_array('個人購課目前暫停。');
  end if;
  if not exists (
    select 1
    from public.course_version_accreditation link
    join public.accreditation_decision_revisions accreditation
      on accreditation.id = link.accreditation_revision_id
    where link.course_version_id = target_version
      and accreditation.status in ('applying', 'approved')
      and accreditation.valid_from <= now()
      and accreditation.valid_until >
        version_row.commerce_close_at
  ) then
    reasons := reasons || jsonb_build_array(
      '積分申請或有效期限尚未完成。'
    );
  end if;
  if not exists (
    select 1
    from public.legal_documents legal
    where legal.id = version_row.legal_document_id
      and legal.approved_by_legal
      and legal.effective_at <= now()
      and (legal.superseded_at is null or legal.superseded_at > now())
  ) then
    reasons := reasons || jsonb_build_array('購課條款尚未生效。');
  end if;
  if exists (
    select 1
    from unnest(array[
      'supabase_phone_auth', 'twilio_verify', 'resend',
      'managed_kms', 'malware_scanner', 'external_monitor'
    ]) required(provider)
    where not internal.provider_production_validation_is_current(
      required.provider, now()
    )
  )
  then
    reasons := reasons || jsonb_build_array(
      '核心安全服務的正式驗證已失效。'
    );
  end if;
  if version_row.delivery_type in ('recorded', 'hybrid')
     and not internal.provider_production_validation_is_current(
       'cloudflare_stream', now()
     )
  then
    reasons := reasons || jsonb_build_array(
      '錄播服務目前未通過或已超過營運驗證期限。'
    );
  end if;
  if version_row.delivery_type in ('live', 'hybrid') then
    if not internal.provider_production_validation_is_current(
         'zoom_oauth', now()
       )
       or not internal.provider_production_validation_is_current(
         'zoom_meeting_sdk', now()
       )
    then
      reasons := reasons || jsonb_build_array(
        '直播服務目前未通過或已超過營運驗證期限。'
      );
    end if;
    if not exists (
      select 1 from public.live_sessions session
      where session.course_version_id = target_version
        and session.status in ('scheduled', 'open')
        and session.booking_close_at > now()
    ) then
      reasons := reasons || jsonb_build_array(
        '目前沒有可報名的直播場次。'
      );
    end if;
  end if;
  return jsonb_build_object(
    'purchaseReady', jsonb_array_length(reasons) = 0,
    'reasons', reasons
  );
end
$$;
revoke all on function internal.read_public_course_readiness(uuid)
  from public;

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
       'cloudflare_stream', now()
     )
  then
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
  from public;

create or replace function internal.read_launch_control_workspace()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  if not internal.has_staff_role('platform_admin') then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  return jsonb_build_object(
    'settings', (
      with setting_keys(setting_key, label) as (
        values
          ('legal_approved', '法務文件已核准'),
          ('finance_configured', '財務流程已設定'),
          ('incident_owner_configured', '資安事故負責人已設定'),
          ('bank_account', '人工匯款帳戶'),
          ('finance_high_value_threshold', '高額匯款雙人門檻')
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', setting_keys.setting_key,
        'label', setting_keys.label,
        'value', case
          when setting_keys.setting_key = 'bank_account'
            and current_setting.value is not null
          then current_setting.value - 'accountNumber'
          else current_setting.value
        end,
        'effectiveAt', current_setting.effective_at,
        'revision', current_setting.revision
      ) order by setting_keys.setting_key), '[]'::jsonb)
      from setting_keys
      left join lateral (
        select setting.value, setting.effective_at, setting.revision
        from public.operating_setting_revisions setting
        where setting.setting_key = setting_keys.setting_key
          and setting.effective_at <= now()
          and (
            setting.superseded_at is null
            or setting.superseded_at > now()
          )
        order by setting.revision desc
        limit 1
      ) current_setting on true
    ),
    'settingRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'settingKey', request.setting_key,
        'proposedValue', case
          when request.setting_key = 'bank_account'
          then request.proposed_value - 'accountNumber'
          else request.proposed_value
        end,
        'effectiveAt', request.effective_at,
        'requestReason', request.request_reason,
        'requesterLabel', case
          when length(requester.display_name) < 2 then '管理員'
          else left(requester.display_name, 1)
            || repeat('＊', length(requester.display_name) - 1)
        end,
        'canDecide', request.requested_by <> actor
      ) order by request.created_at, request.id)
      from public.operating_setting_change_requests request
      join public.people requester on requester.id = request.requested_by
      where request.status = 'pending_review'
    ), '[]'::jsonb),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', health.provider,
        'status', health.status,
        'checkedAt', health.checked_at,
        'lastSuccessAt', health.last_success_at,
        'productionValidatedAt', health.production_validated_at,
        'productionValidationExpiresAt',
          health.production_validation_expires_at,
        'validationCurrent',
          internal.provider_production_validation_is_current(
            health.provider, now()
          )
      ) order by health.provider)
      from public.provider_health health
    ), '[]'::jsonb),
    'providerRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'provider', request.provider,
        'evidenceReference', request.evidence_reference,
        'evidenceSha256', request.evidence_sha256,
        'testedAt', request.tested_at,
        'evidenceExpiresAt', request.tested_at + interval '90 days',
        'requestReason', request.request_reason,
        'requesterLabel', case
          when length(requester.display_name) < 2 then '管理員'
          else left(requester.display_name, 1)
            || repeat('＊', length(requester.display_name) - 1)
        end,
        'canDecide', request.requested_by <> actor,
        'canApprove',
          request.requested_by <> actor
          and request.tested_at <= now()
          and request.tested_at > now() - interval '90 days'
          and exists (
            select 1
            from public.provider_health health
            where health.provider = request.provider
              and health.status = 'healthy'
              and health.checked_at >= now() - interval '15 minutes'
              and health.last_success_at is not null
          )
      ) order by request.created_at, request.id)
      from public.provider_validation_requests request
      join public.people requester on requester.id = request.requested_by
      where request.status = 'pending_review'
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_launch_control_workspace()
  from public;

create or replace function internal.read_accreditation_operations_workspace()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  can_create_batch boolean := internal.has_staff_role('course_admin');
  can_manage_lifecycle boolean :=
    internal.has_staff_role('accreditation_reviewer');
begin
  if not can_create_batch and not can_manage_lifecycle then
    raise exception 'ACCREDITATION_OPERATIONS_ROLE_REQUIRED';
  end if;
  return jsonb_build_object(
    'canCreateBatch', can_create_batch,
    'canManageLifecycle', can_manage_lifecycle,
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', latest.id,
        'courseId', latest.course_id,
        'courseLabel', course.internal_title,
        'revision', latest.revision,
        'status', latest.status,
        'applicationReference', latest.application_reference,
        'approvalReference', latest.approval_reference,
        'points', latest.points,
        'validFrom', latest.valid_from,
        'validUntil', latest.valid_until,
        'retroactive', latest.retroactive,
        'canRequestTransition',
          can_manage_lifecycle
          and latest.status in ('applying', 'approved')
          and not exists (
            select 1
            from public.accreditation_transition_requests pending
            where pending.source_revision_id = latest.id
              and pending.status = 'pending_review'
          )
      ) order by course.internal_title, latest.revision desc)
      from (
        select distinct on (revision.course_id) revision.*
        from public.accreditation_decision_revisions revision
        order by revision.course_id, revision.revision desc
      ) latest
      join public.courses course on course.id = latest.course_id
      where course.archived_at is null
    ), '[]'::jsonb),
    'transitionRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'sourceRevisionId', request.source_revision_id,
        'courseLabel', course.internal_title,
        'requestedStatus', request.requested_status,
        'approvalReference', request.approval_reference,
        'points', request.points,
        'validFrom', request.valid_from,
        'validUntil', request.valid_until,
        'effectiveAt', request.effective_at,
        'retroactive', request.retroactive,
        'retroactiveBasis', request.retroactive_basis,
        'sourceDocumentPath', request.source_document_path,
        'sourceDocumentSha256', request.source_document_sha256,
        'requestReason', request.request_reason,
        'requesterLabel', case
          when length(requester.display_name) < 2 then '積分審核員'
          else left(requester.display_name, 1)
            || repeat('＊', length(requester.display_name) - 1)
        end,
        'canDecide',
          can_manage_lifecycle and request.requested_by <> actor
      ) order by request.created_at, request.id)
      from public.accreditation_transition_requests request
      join public.accreditation_decision_revisions source
        on source.id = request.source_revision_id
      join public.courses course on course.id = source.course_id
      join public.people requester on requester.id = request.requested_by
      where request.status = 'pending_review'
    ), '[]'::jsonb),
    'batchCourseOptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'courseVersionId', version.id,
        'label', version.title || '（v' || version.version::text || '）',
        'accreditationRevisionId', current_revision.id,
        'accreditationLabel',
          coalesce(current_revision.approval_reference, '尚未核定'),
        'liveSessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', session.id,
            'label', session.title || '／'
              || session.starts_at::date::text
          ) order by session.starts_at, session.id)
          from public.live_sessions session
          where session.course_version_id = version.id
            and session.status = 'ended'
        ), '[]'::jsonb)
      ) order by version.title, version.version)
      from public.course_versions version
      join lateral (
        select revision.*
        from public.accreditation_decision_revisions revision
        where revision.course_id = version.course_id
        order by revision.revision desc, revision.id
        limit 1
      ) current_revision on true
      where version.status = 'published'
        and current_revision.status = 'approved'
        and current_revision.effective_at <= now()
        and current_revision.valid_from <= now()
        and current_revision.valid_until > now()
        and exists (
          select 1
          from public.course_version_accreditation link
          where link.course_version_id = version.id
            and link.accreditation_revision_id = current_revision.id
        )
    ), '[]'::jsonb),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', batch.id,
        'courseVersionId', batch.course_version_id,
        'courseLabel', version.title,
        'accreditationRevisionId', batch.accreditation_revision_id,
        'liveSessionId', batch.live_session_id,
        'status', batch.status,
        'templateVersion', batch.template_version,
        'externalReference', batch.external_submission_reference,
        'supersedesBatchId', batch.supersedes_batch_id,
        'isolatedAt', batch.isolated_at,
        'isolationReason', batch.isolation_reason,
        'createdAt', batch.created_at,
        'canCreateCorrection',
          can_create_batch
          and batch.status = 'needs_correction'
          and batch.isolated_at is null
          and internal.accreditation_submission_scope_is_valid(
            batch.course_version_id,
            batch.accreditation_revision_id,
            batch.live_session_id,
            now()
          )
          and not exists (
            select 1
            from public.accreditation_submission_batches child
            where child.supersedes_batch_id = batch.id
          ),
        'canMarkSubmitted',
          can_manage_lifecycle
          and batch.status = 'exported'
          and batch.isolated_at is null
          and batch.requested_by <> actor
          and internal.accreditation_submission_scope_is_valid(
            batch.course_version_id,
            batch.accreditation_revision_id,
            batch.live_session_id,
            now()
          )
          and internal.batch_has_valid_active_claims(batch.id),
        'canRecordResults',
          can_manage_lifecycle
          and batch.status = 'submitted'
          and batch.isolated_at is null
          and batch.requested_by <> actor
          and batch.submitted_by is distinct from actor
          and internal.accreditation_submission_scope_is_valid(
            batch.course_version_id,
            batch.accreditation_revision_id,
            batch.live_session_id,
            now()
          )
          and internal.batch_has_valid_active_claims(batch.id),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'enrollmentId', item.enrollment_id,
            'learnerLabel', case
              when length(person.display_name) < 2 then '學員'
              else left(person.display_name, 1)
                || repeat('＊', length(person.display_name) - 1)
            end,
            'status', item.status,
            'missingReasons', item.missing_reasons
          ) order by item.enrollment_id)
          from public.accreditation_submission_items item
          join public.enrollments enrollment
            on enrollment.id = item.enrollment_id
          join public.people person on person.id = enrollment.person_id
          where item.batch_id = batch.id
        ), '[]'::jsonb)
      ) order by batch.created_at desc, batch.id desc)
      from public.accreditation_submission_batches batch
      join public.course_versions version
        on version.id = batch.course_version_id
      where batch.created_at >= now() - interval '2 years'
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_accreditation_operations_workspace()
  from public;
