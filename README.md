# 歲悅學苑

Production-oriented, mobile-first long-term-care credit course platform built with
Next.js 16, Node.js 22-compatible APIs, and Supabase.

The application supports B2C single-course manual-bank purchases, B2B
non-expiring point wallets, recorded/live/hybrid learning, evidence-based
attendance, quizzes, surveys, accreditation operations, certificates,
notifications, and role-specific administration. Every launch feature starts
closed. No demonstration course, fake learner, payment, completion, or
certificate is seeded.

## Safety posture

- Learners sign in only with Supabase Phone Auth and Twilio Verify. Email is an
  optional verified contact channel, never a login method.
- Turnstile is required at the Supabase Auth layer, not only in the Next.js UI.
- Manual bank transfer is the only payment method. A submitted proof never
  unlocks access; an immutable bank transaction allocation must exactly match.
- Browser input cannot authoritatively set money, points, time, attendance,
  scores, eligibility, certificates, roles, or exports.
- All nine feature switches default to `false`; missing legal, finance,
  provider, KMS, operating-identity, or incident-owner readiness closes the
  capability.
- Public tables use explicit RLS and grants. Sensitive writes use narrow RPCs.
  Genuine `SECURITY DEFINER` functions live in the unexposed `internal` schema,
  pin `search_path`, revoke public execution, and authorize internally.
- The visible learner overlay is not represented as forensic watermarking.
  Zoom passcodes and registrant tokens exist in browser memory only for join.
  Camera state is attendance evidence, not face or gaze recognition.

## Architecture

```text
src/domain/             Pure state, money, attendance, graph, and gate rules
src/application/        Use cases that call narrow transactional RPCs
src/infrastructure/     Supabase, security, Stream, Zoom, Resend, KMS, bank ports
src/app/                Thin App Router pages and route handlers
supabase/migrations/    Clean reset + responsibility-separated baseline
tests/                  Domain, security, concurrency, SQL, and adapter proofs
docs/runbooks/          Operations, provider, finance, reset, recovery, launch
```

Postgres is authoritative. Next.js routes authenticate, validate with Zod,
enforce same-origin/idempotency, and call the database/application boundary.
High-frequency playback and live events use per-session sequence and lease
epochs instead of a global idempotency table.

## Local setup

Requirements:

- Node.js 22, 23, or 24
- pnpm 11.2.2
- Supabase CLI 2.105 or newer
- Docker-compatible local container runtime if applying the local database

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
supabase start
pnpm dev
```

The local-only test identity is `+886900000000` with OTP `246810`, configured in
`supabase/config.toml`. Hosted environments must not copy `auth.sms.test_otp`.
Application mock adapters additionally require:

```dotenv
APP_ENV=development
ALLOW_LOCAL_MOCK_PROVIDERS=true
EMERGENCY_DISABLE_ALL=false
EMERGENCY_DISABLE_PAYMENTS=false
EMERGENCY_DISABLE_EXPORTS=false
EMERGENCY_DISABLE_CERTIFICATES=false
```

These emergency values are appropriate only for an isolated local database.
Hosted environments stay closed until the related launch gates pass. Mocks
throw in production even if the flag is accidentally set.

After `supabase start`, run `supabase status -o env` and copy only the local
values into `.env.local`:

- `API_URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `ANON_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`

For authenticated local routes, also create development-only random values of
at least 32 characters for `RATE_LIMIT_HMAC_SECRET`, `CRON_SECRET`,
`BANK_IMPORT_HMAC_SECRET`, `EMAIL_VERIFICATION_HMAC_SECRET`,
`PII_BLIND_INDEX_KEY_CURRENT`, and
`ORGANIZATION_INVITATION_BLIND_INDEX_KEY`. Local PII and Zoom workflows
additionally need separate random 32-byte base64url values for
`LOCAL_KMS_MASTER_KEY` and `ZOOM_SECRET_ENCRYPTION_KEY`. Never reuse these
values outside the isolated local stack.

With the explicit mock flag above, the login page shows the local test phone
and OTP and does not call Turnstile or Twilio. Hosted environments must enable
both providers in the Supabase control plane before login can open.

## Environment matrix

| Environment  | Database                           | Auth/providers                                   | Secrets                     |
| ------------ | ---------------------------------- | ------------------------------------------------ | --------------------------- |
| Local        | Local Supabase                     | Fixed test OTP and explicit mocks                | Development-only values     |
| Test/Preview | Isolated branch/project            | Provider sandboxes, Turnstile                    | Preview-only server secrets |
| Production   | Existing approved Supabase project | Twilio Verify, Stream, Zoom, Resend, managed KMS | Server/control-plane only   |

Only these values are browser-safe:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE`
- `NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY`

All other values in `.env.example` are server-only. Production PII KEKs remain
in a managed KMS; the application receives only KMS usage authority.
For Zoom, `ZOOM_MEETING_SDK_ACCOUNT_ID` is a required deployment attestation
and must exactly equal the Server-to-Server OAuth `ZOOM_ACCOUNT_ID`. The
configured host is also read back from Zoom and rejected unless its
`account_id` matches that same account.

## Database baseline

The clean baseline has ten responsibility-separated migrations created with
`supabase migration new`, followed by two forward hardening migrations:

1. inventoried legacy reset guard
2. identity, RBAC, legal, recovery, and fail-closed features
3. course versions, content graph, Stream assets, and accreditation
4. manual-bank commerce, immutable allocation, invoice, and refunds
5. recorded learning, presence challenges, quizzes, and surveys
6. Zoom resources, live/hybrid booking, and attendance evidence
7. organization wallets, non-expiring point lots, and assignments
8. eligibility, exports, certificates, archive, backup, and deletion manifests
9. audit, provider events, notifications, jobs, quarantine, and incidents
10. RLS, grants, views, transactional RPCs, and two-admin bootstrap
11. idempotent Stream/Zoom provider-operation sagas and lease repair
12. API authorization preflights, bounded request handling, and runtime health
    signals

The reset migration drops only inventoried application objects. If legacy
objects exist, it aborts unless the linked project reference, frozen migration
fingerprint, and protected-data zero counts all match. It never drops Supabase
system schemas.

See [reset-and-forward-fix.md](docs/runbooks/reset-and-forward-fix.md) before any
remote migration. This repository does not run remote reset or migration
commands automatically.

## Primary user surfaces

| Route                             | Purpose                                               |
| --------------------------------- | ----------------------------------------------------- |
| `/courses`                        | Published, currently sellable long-term-care courses  |
| `/login`                          | Taiwan mobile number and six-digit SMS OTP            |
| `/learner`                        | Learner progress, next action, and certificate state  |
| `/learner/courses/[enrollmentId]` | Signed recorded playback                              |
| `/live/[liveSessionId]`           | Zoom Meeting SDK classroom                            |
| `/organization/workspace`         | Wallet, members, assignment, and reports              |
| `/staff`                          | AAL2 staff queues                                     |
| `/staff/[queue]`                  | Course, finance, live, accreditation, org, operations |
| `/verify/[token]`                 | Masked, constant-shape, noindex certificate check     |
| `/api/health`                     | Fail-closed configuration readiness                   |

## Verification

```bash
pnpm verify
```

It runs:

1. Prettier diff check
2. `git diff --check`
3. ESLint with zero warnings
4. TypeScript without emit
5. Vitest domain/security/concurrency suite
6. migration/RLS/GRANT/static SQL proof with measured counts
7. tracked-file secret scan
8. resulting-tree forbidden legacy-capability scan
9. production dependency advisory scan
10. production Next.js build

GitHub Actions additionally starts an isolated local Supabase stack, applies
the full migration chain twice, lints the resulting database, and runs the
database role/concurrency tests. It never links to or resets a hosted project.

When Docker is available, also run twice against a fresh local database:

```bash
supabase db reset
supabase db reset
supabase db lint --local --level warning
```

No provider, device, legal, bank, load, or human UAT result should be claimed
from unit tests. Those gates are listed in
[launch-checklist.md](docs/runbooks/launch-checklist.md).

## Operations

- [Provider setup and webhook replay](docs/runbooks/providers.md)
- [Manual bank, invoice, refund, and point SOP](docs/runbooks/finance.md)
- [Two-admin bootstrap and break-glass](docs/runbooks/bootstrap.md)
- [Incident response and kill switches](docs/runbooks/incident.md)
- [Backup, restore, tombstone replay](docs/runbooks/backup-restore.md)
- [PII copies and key dependencies](docs/runbooks/pii-map.md)
- [Reset and forward-fix deployment](docs/runbooks/reset-and-forward-fix.md)
- [External launch blockers and UAT](docs/runbooks/launch-checklist.md)

## Provider-dependent limitations

Provider adapters are real and credentialless in Git. Without credentials or
control-plane approval, they fail closed:

- Supabase hosted Auth still needs Phone-only providers, Turnstile, exact
  redirects, templates, hooks, abuse limits, Twilio spend cap, external identity
  risk signals, and high-assurance recovery completion verified.
- Cloudflare Stream needs API, signing, webhook, and master-backup configuration.
- Zoom needs OAuth, licenses/hosts, webhook, CSP rehearsal, and verified total
  capacity. The client loads only the allowlisted official Meeting SDK 6.2.0
  browser artifacts; registrant revocation failure blocks a replacement lease
  until the old credential expires.
- Resend needs domain SPF/DKIM and webhook configuration.
- PII and export encryption needs the chosen managed-KMS implementation,
  permissions, rotation, and two-person offline recovery.
- The quarantine worker and adapter boundary are implemented; production
  promotion remains closed until a real scanner/sanitizer endpoint passes
  malicious PDF/Office, metadata, MIME, and archive-expansion acceptance.

See `PLAN.md` for the frozen normative specification.
