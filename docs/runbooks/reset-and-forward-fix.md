# Reset and forward-fix runbook

This is a human-approved, production-only procedure. Never run it from CI,
Preview, or the builder session.

## Before the write fence

1. Confirm repository, branch, linked Supabase reference, Vercel project, and
   operator identities.
2. Inventory Auth users/sessions, Storage objects, orders, bank/payment records,
   enrollments, learning events, certificates, organizations, and point events.
3. Stop immediately if any protected count is not the expected zero.
4. Inventory hosted Auth providers/templates/redirects/CAPTCHA/hooks, Vercel
   secrets/Cron/domains, Storage buckets/objects, provider webhook endpoints,
   Stream assets, Zoom meetings/apps, and credentials.
5. Produce a schema/object inventory, migration checksum list, and Storage
   object-count manifest only. Do not export or preserve legacy business data;
   the approved rebuild intentionally has no legacy-data rollback.

## Write fence

1. Deploy a maintenance release that does not depend on the legacy database.
2. Disable Auth signup, legacy Cron and webhooks.
3. Revoke legacy service credentials and drain in-flight jobs.
4. Repeat the protected-data and zero-writer assertions.
5. Keep the maintenance release until every post-check passes.

## Reset guard

The reset migration only operates when legacy objects exist and both guard
settings match. A plain `SET` is not sufficient because `supabase db push`
opens a different database connection. While the maintenance write fence is
active, an authorized database operator must persist the guards for the
`postgres` database:

```sql
alter database postgres
  set app.suiyue_project_ref = 'eswdhynrbzrjgetnmhit';
alter database postgres
  set app.suiyue_legacy_fingerprint =
  '9520c33bac3a0b4f719344ddba5ae25e98067dcdd5c7115da67570736d7eefbc';
```

The fingerprint is the frozen normalized concatenation of the seven disposable
legacy application migrations. The migration again counts protected business
tables and aborts on any non-zero value. It drops only enumerated application
tables; it does not drop `auth`, `storage`, `realtime`, `extensions`, `vault`,
`graphql`, or migration history. After the migration and object checks pass,
remove both temporary guards:

```sql
alter database postgres reset app.suiyue_project_ref;
alter database postgres reset app.suiyue_legacy_fingerprint;
```

## Migration history and apply

1. Rehearse the complete chain twice on local and once on the isolated test
   project.
2. Use only `supabase migration repair --status reverted` for legacy hosted
   history alignment. Never edit the migration history table directly.
3. Run `supabase db push --dry-run` and save output for reviewer approval.
4. Apply only after an explicit human go/no-go.
5. If push fails after repair, keep maintenance active and forward-fix. Do not
   attempt to restore the old application or claim rollback is available.

## Post-check

- Every migration version committed under `supabase/migrations` is present in
  order and its checksum matches the reviewed repository state.
- All public tables have RLS, explicit grants, and no unexpected policies.
- Security Advisor reviewed.
- Feature switches all disabled.
- No course, person, order, enrollment, completion, or certificate seeded.
- Phone-only Auth, exact redirects, Turnstile, hooks, and TOTP verified.
- Provider events reject wrong environment/signature/replay.
- Restore and tombstone replay proof saved.

Only after application smoke tests and launch gates pass may the maintenance
fence be removed. Feature switches remain closed until the full launch review.
