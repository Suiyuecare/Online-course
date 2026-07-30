# Minimum incident response

## First 15 minutes

1. A platform administrator opens Operations and uses **Fresh TOTP 後全部暫停**.
   The database atomically disables all nine feature switches, creates a
   critical contained `security_incidents` row, enables maintenance mode,
   appends audit, and queues administrator SMS/Email.
2. Confirm payment, assignment, playback, Zoom, export, and certificate
   operations now fail closed. The control never deletes existing evidence.
3. Preserve Vercel, Supabase, provider, application, audit, and external-monitor
   evidence.
4. Raise affected identity/session epochs and revoke affected sessions.
5. Notify both platform administrators through the independent alert receiver.

## Contain and investigate

- Rotate only affected server/provider credentials.
- Verify audit hash chain/checkpoint, bank allocations, points, effective
  minutes, attendance, eligibility, and certificates.
- Zero-tolerance alerts: cross-tenant read, negative points, unpaid entitlement,
  positive time drift, or incorrect certificate.
- Keep external status and dead-man monitoring independent of the primary
  Supabase/Vercel login plane.
- Treat a failed `Production worker and demo pulse` GitHub Actions run as an
  operations incident. Confirm the Vercel function response, durable-job queue,
  worker heartbeat, and repository secret before retrying; never weaken the
  health freshness gate to make the alert disappear.

## Legal and customer decision

Contact Taiwanese privacy/legal counsel immediately to determine customer and
authority notice duties. When applicable, track the 72-hour deadline in the
incident record. Messages disclose confirmed scope only and do not include
sensitive attachments.

Close only after kill switches, audit preservation, alert delivery, and affected
state reconciliation are independently reviewed.
