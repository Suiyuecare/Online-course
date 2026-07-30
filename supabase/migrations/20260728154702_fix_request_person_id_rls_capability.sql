-- Existing owner-read RLS policies call this zero-argument helper, but the
-- bootstrap migration revoked PUBLIC execution without restoring the
-- authenticated capability. Granting it fixes those policies without exposing
-- a target-person parameter or widening any row predicate.

revoke all on function internal.request_person_id()
  from public, anon, authenticated, service_role;

grant execute on function internal.request_person_id()
  to authenticated;
