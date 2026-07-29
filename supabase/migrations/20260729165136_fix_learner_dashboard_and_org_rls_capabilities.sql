-- Repair the narrow capabilities required by security-invoker learner views
-- and organization RLS predicates. Keep grants column-scoped so browser roles
-- do not gain access to raw attendance evidence or unrelated enrollment data.

revoke all on function internal.has_organization_role(uuid, text[])
  from public, anon, authenticated, service_role;

grant execute on function internal.has_organization_role(uuid, text[])
  to authenticated;

grant select (entitlement_id)
  on public.enrollments to authenticated;

grant select (hold_expires_at)
  on public.live_bookings to authenticated;

drop policy if exists own_attendance_summaries_read
  on public.attendance_summaries;

create policy own_attendance_summaries_read
on public.attendance_summaries
for select to authenticated
using (
  exists (
    select 1
    from public.live_bookings booking
    where booking.id = attendance_summaries.live_booking_id
      and booking.person_id = internal.request_person_id()
  )
);

grant select (live_booking_id, quarantined_at)
  on public.attendance_summaries to authenticated;
