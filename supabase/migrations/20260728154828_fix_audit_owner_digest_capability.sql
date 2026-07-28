-- The append-only audit writer is owned by an isolated NOLOGIN role. Its hash
-- chain calls pgcrypto.digest, so that owner needs schema usage and only the
-- two digest overloads used by audit/hardening routines.

grant usage on schema extensions to suiyue_audit_owner;

grant execute on function extensions.digest(text, text)
  to suiyue_audit_owner;
grant execute on function extensions.digest(bytea, text)
  to suiyue_audit_owner;
