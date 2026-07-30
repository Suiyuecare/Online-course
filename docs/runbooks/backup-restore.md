# Backup, restore, and tombstone replay

## Schedule

- Supabase Pro daily database backup with seven-day retention; no PITR.
- Weekly encrypted database export.
- Daily versioned Storage object backup with object count, bytes, and SHA-256
  manifest.
- Separate private backup for Cloudflare video masters.
- Extra encrypted database export before each production migration.
- Restore rehearsal every six months.

Accepted worst-case RPO is close to 24 hours. Target RTO is eight hours; update
the runbook and external promise if a rehearsal cannot meet it.

## Restore sequence

1. Restore into an isolated test project, never over production first.
2. Verify database backup identity and checksums.
3. Restore versioned Storage objects and verify daily manifest.
4. Reload a sample cold event archive and recompute its summary/hash.
5. Replay deletion tombstones from the independent control-plane manifest
   before allowing any application access.
6. Validate wrapped DEKs/KMS authority and complete a two-person KEK recovery
   exercise without exposing plaintext.
7. Reconcile bank, Zoom, Stream, Resend, audit checkpoints, and last successful
   worker signals.
8. Run `pnpm verify`, RLS multi-tenant tests, and application smoke tests.
9. Record measured RPO/RTO, discrepancies, owner, and forward fixes.

Never claim Storage is covered by a database-only backup.

## Operations evidence ledger

The Operations Control Plane records evidence produced by the procedures above;
it does **not** call Supabase backup, Storage copy, KMS, archive, or deletion
providers. Before recording an event:

1. Complete the external backup, restore, reload, tombstone replay, or audit
   verification using the approved provider runbook.
2. Store the evidence outside the application and calculate its SHA-256.
3. In Operations, record the evidence kind, approved target, result, observation
   time, SHA-256, external reference, and a non-sensitive reason.
4. Complete fresh TOTP. The application appends an immutable evidence event and
   audit event; it never stores or displays provider credentials or object
   paths in the staff projection.

The five Storage targets are `quarantine`, `safe-uploads`, `certificates`,
`legal-documents`, and `accreditation-exports`. A missing manifest or restore
verification remains visibly missing. Do not create a passing evidence event
to silence readiness or an alert.

For dead-letter work, the control plane can requeue only database-local,
idempotent `completion_evaluate`, `recorded_progress_recompute`, and
`live_attendance_settle` jobs. Notification, Zoom, Stream, Storage, identity,
and other provider-side effects require their dedicated reconciliation path;
an acknowledgement is an immutable operator note, not recovery.

## Retention dry-run control

The Operations retention workspace is evidence-only. It does not delete,
truncate, archive, move, or anonymize protected data.

1. A platform administrator selects an effective policy revision, provides a
   non-sensitive reason, and completes fresh target-bound TOTP.
2. The database executes one fixed allowlisted candidate query, recording only
   cutoff time, candidate count, and digest. Dynamic SQL is prohibited.
3. A different platform administrator independently compares that digest with
   the approved external evidence. The reviewer first records a target-bound,
   append-only `retention_candidate_manifest_verified` evidence event after
   fresh TOTP; its SHA-256 must exactly match the dry-run candidate digest.
4. Approve or reject requires another target-bound fresh TOTP and the exact
   evidence-event ID. The decision cannot accept a free-form hash or an
   unrelated evidence record.
5. All records and their audit events are append-only and explicitly state
   `physicalPurgePerformed=false`.

Approval is not authority or machinery to purge. Any future physical lifecycle
operation requires a separately reviewed specification, legal sign-off,
restore/tombstone plan, dedicated implementation, and another launch gate.
