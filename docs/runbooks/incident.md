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

- Use the Operations Control Plane incident card for every state change.
  `contain`, `investigate`, legal-contact recording, `resolve`, `reopen`, and
  `close` are proposed by one platform administrator and approved or rejected
  by a different platform administrator. Both steps require fresh, target-bound
  TOTP and append separate immutable incident and audit events.
- Never update `security_incidents` directly. A stale proposal is rejected if
  the incident changed while it was awaiting review.
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
- `/api/health/live` is the only public health signal and must contain only
  `{"status":"live"}`. Detailed `/api/health` readiness requires the cron
  bearer secret or an authenticated platform administrator. Never expose
  provider status, capability flags, backlog, or failure reasons to make an
  unauthenticated monitor convenient.
- SLA escalation jobs append a local evidence event only. They intentionally do
  not send Email, SMS, or provider notifications. Staff must use the approved
  case workflow when customer contact is required; the escalation event is not
  proof that a person was contacted.

## Audit explorer handling

The staff audit explorer is a metadata verifier, not a log-export endpoint. It
returns action, target type, a one-way target reference, actor kind, scope
flags, event hash, sequence, and time. It never returns event payload, reason
text, source IP, request ID, or raw target identifier. If the safe projection
is unavailable, do not replace it with direct table access or copy raw audit
rows into a support ticket.

## Legal and customer decision

Contact Taiwanese privacy/legal counsel immediately to determine customer and
authority notice duties. When applicable, track the 72-hour deadline in the
incident record. Messages disclose confirmed scope only and do not include
sensitive attachments.

Close only after kill switches, audit preservation, alert delivery, and affected
state reconciliation are independently reviewed. Acknowledging a dead-letter
does not make it healthy; provider-side work remains in `dead_letter` until its
dedicated reconciliation flow proves the external state.
