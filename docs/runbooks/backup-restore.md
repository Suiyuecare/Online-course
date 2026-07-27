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
