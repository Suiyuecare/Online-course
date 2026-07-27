# Provider configuration and replay

## Supabase Phone Auth / Twilio Verify

- Hosted Auth: enable Phone, disable email/password, OAuth, anonymous, and
  manual linking.
- Configure Twilio Verify credentials in Supabase control-plane secrets.
- Enforce Cloudflare Turnstile in Auth settings so direct `/auth/v1/otp` calls
  cannot bypass it.
- Set OTP expiry to five minutes, resend to 60 seconds, phone/IP/device limits,
  Twilio spend cap, and abuse alerts.
- Configure exact production/preview redirects; never restore wildcard Preview
  callbacks.
- Verify restricted identities cannot use PostgREST, RPC, Storage, Stream,
  Zoom, certificates, or exports.
- Configure the identity-risk adapter and high-assurance recovery adapter.
  Missing or unknown risk is restricted for identities with prior payment,
  certificate, or sensitive identity data. Recovery remains restricted through
  two distinct administrators, a 24-hour cooling period, old-channel
  notifications, and external completion proof.

## Cloudflare Stream

- Create least-privilege API and signing keys; keep them server-only.
- Direct upload URLs expire in 15 minutes and require signed playback.
- Webhook endpoint: `/api/webhooks/stream`.
- Reject timestamps over five minutes, bad signatures, wrong environment, and
  duplicate canonical fingerprints.
- Do not publish until asset status is ready and a private master backup
  reference exists.
- The backup reference is accepted only after the independent master-backup
  adapter verifies the immutable reference and SHA-256.
- Signed playback token lifetime is at most five minutes.

## Zoom

- Configure Server-to-Server OAuth, Meeting SDK app, webhook secret, licensed
  main/backup hosts, and verified total capacity.
- Record the Meeting SDK app owner as `ZOOM_MEETING_SDK_ACCOUNT_ID`; deployment
  readiness requires it to equal `ZOOM_ACCOUNT_ID`. For every host reference,
  the preflight must read back both Zoom's canonical host ID and `account_id`.
  A missing or different account ID blocks meeting creation.
- Webhook endpoint: `/api/webhooks/zoom`; subscribe only to required meeting and
  participant events.
- Meetings use waiting room, registration, disabled rename/share/recording, and
  muted entry.
- Synthetic registrant email is random under `zoom-id.suiyuecare.com`; disable
  Zoom mail and catch-all delivery.
- Passcode, registrant token, participant SDK signature, host ZAK, and OAuth
  token must never enter URLs, logs, analytics, or browser storage.
- Host console requires fresh TOTP and a strict Zoom-only CSP. ZAK exists only
  in memory and is cleared after join.
- On device takeover, revoke old registrant, remove old participant, and disable
  rejoin. If provider revocation is not proven, deny the new lease until expiry.
- After Zoom creates a registrant, stage its encrypted token and durable
  reconciliation job before writing the immutable receipt. A failed receipt
  response, including an authoritative read that currently returns null, never
  authorizes inline revocation. The worker locks the same receipt fence before
  preserving or revoking; a sealed absent-receipt decision rejects every late
  receipt, so the join API cannot return a revoked `tk`.
- Reschedule/cancel requests first enter a durable database job. The worker
  updates/deletes the Zoom meeting and only then finalizes database time,
  capacity reservation, ICS sequence, join leases, and learner notifications.
  A failure leaves the session reconciling and closed to new admission.
- Initial creation and recovery both read the meeting back and verify scheduled
  meeting type, exact topic, start time (within 60 seconds), duration, canonical
  host, accountless registration, waiting room, participant controls, and
  recording policy before the immutable receipt can schedule the session.
- If a conclusively duplicate or pre-receipt meeting cannot be deleted, the
  API enqueues `zoom_orphan_cleanup:<meeting-number>`. Only Zoom 204/404
  completes it; failures retry and remain visible in the live/operations
  worklists, while a fresh authoritative receipt can cancel deletion before a
  worker leases the job.
- Durable jobs reclaim expired `leased` rows with a monotonically increasing
  lease generation. Context reads, completion, retry, credential expiry, and
  orphan cleanup require both owner and generation. If a worker crashes after
  Zoom DELETE returns 204, the next generation repeats the idempotent DELETE
  (404 is also success) and completes; the stale generation cannot win an ABA
  race.

## Resend

- Verify `mail.suiyuecare.com` SPF/DKIM.
- Webhook endpoint: `/api/webhooks/resend`.
- Website notification is authoritative; accepted/delivered/bounced/complained
  events never mutate payment, attendance, or eligibility.
- Worker sends only leased outbox rows with business idempotency keys.

## Safe replay

Replay only a captured test/sandbox payload. Recompute the provider signature
with the sandbox secret and current timestamp. Confirm:

- first event is accepted;
- identical native ID/fingerprint deduplicates;
- wrong environment/signature rejects;
- stale timestamp rejects;
- the production-reset write fence rejects all legacy writers; the separate
  runtime emergency switch still accepts correctly signed provider evidence
  and processes only the documented evidence-preservation allowlist;
- processing failure records a retry/dead-letter without changing authority.

Never replay a production payment, participant, or notification event into
Local/Preview.
