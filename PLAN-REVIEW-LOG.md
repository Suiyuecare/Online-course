# Plan Review Log: 歲悅學苑三線正式收費平台
Act 1 (grill) complete — plan locked with the user. MAX_ROUNDS=5.

## Round 1 — Codex

1. **Critical — migration lineage is unresolved.** The repo deletes five tracked migrations and reintroduces them under new timestamps, several with changed contents; if the old versions reached Supabase, the renamed chain will replay conflicting DDL, while the reset migration deliberately aborts once Auth or Storage contains data ([plan](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:170), [reset migration](/Users/seniorlifepr/Documents/線上課程平台/supabase/migrations/20260720161816_reset_apm_to_suiyue.sql:16)).  
   **Fix:** Restore every applied migration under its original timestamp/checksum, quarantine the renamed chain, and add one new forward-only reconciliation migration with explicit fresh-database and deployed-database branches.

2. **Critical — `course_version` has no executable backfill or cutover.** Existing orders, enrollments, lessons, progress, certificates, prices, and live sessions all reference mutable `course_id`; the plan neither maps them to baseline versions nor defines progress/exam handling during forced transfers ([current schema](/Users/seniorlifepr/Documents/線上課程平台/supabase/migrations/20260720161818_initial_learning_platform_schema.sql:95)).  
   **Fix:** Create one immutable baseline version per existing course, backfill and validate `course_version_id` on every dependent row, enforce `NOT NULL`/FKs and published-version mutation guards, and prohibit forced transfer until explicit progress/exam/certificate carry rules exist.

3. **Critical — account merging contradicts immutable audit history and cannot be one transaction.** Many records reference `auth.users` with `ON DELETE CASCADE`, while moving Supabase Auth identities and application rows cannot be made atomic through the Auth Admin API ([example](/Users/seniorlifepr/Documents/線上課程平台/supabase/migrations/20260720161818_initial_learning_platform_schema.sql:176)).  
   **Fix:** Introduce a stable `person_id` plus account/identity aliases, retain historical actor/user snapshots without rewriting events, revoke the source account’s sessions, and replace cascading audit FKs with restrictive or nullable references.

4. **Critical — the PII encryption promise is impossible as written.** Phone login necessarily stores the phone in Supabase Auth, and OAuth identity metadata may also retain provider profile data; the current public profile additionally stores name and phone plaintext ([Supabase user model](https://supabase.com/docs/guides/auth/users), [schema](/Users/seniorlifepr/Documents/線上課程平台/supabase/migrations/20260720161818_initial_learning_platform_schema.sql:22)).  
   **Fix:** Produce a field-by-field PII inventory documenting unavoidable Auth/provider plaintext, remove redundant public copies, minimize LINE scopes/claims, and scope AES encryption claims only to application-controlled domain data.

5. **High — key rotation is named but not designed.** The current envelope has only `v1`, its database “encryption version” is merely an update counter, and the same key currently drives encryption and the blind index ([crypto](/Users/seniorlifepr/Documents/線上課程平台/src/lib/accreditation-crypto-core.ts:16), [profile schema](/Users/seniorlifepr/Documents/線上課程平台/supabase/migrations/20260720161822_phase_two_accreditation_operations.sql:61)).  
   **Fix:** Store immutable encryption-key and HMAC-key IDs per record, use independent keys, support dual blind indexes during rotation, and specify resumable re-encryption with verification and rollback.

6. **Critical — “AAL2 plus recent reauthentication” is not an authorization rule.** Supabase’s `aal2` claim proves that a second factor was used but does not establish action-specific recency, and the plan omits lost-factor recovery, break-glass access, and session revocation after role changes ([Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)).  
   **Fix:** Require a short-lived, action-scoped server-side step-up grant in addition to AAL2, enforce it in every API/RPC, revoke sessions after role changes, and define audited TOTP recovery and break-glass procedures.

7. **High — B2B invitations are not bound safely to the new identity model.** Invitations and imports are keyed by Email even though Email is no longer an authentication identity, so a forwarded bearer link could attach membership and imported personal data to an unrelated phone/LINE account.  
   **Fix:** Require a logged-in phone/LINE account plus verification of the invitation Email before atomic claim, with hashed single-use tokens, expiry, replay prevention, and an audited administrator exception path.

8. **High — four-eyes approval and the four staff roles are only prose.** “Second-person review” does not explicitly prohibit self-approval, and page-level visibility does not constrain service-role routes that bypass RLS.  
   **Fix:** Add a default-deny endpoint/RPC permission matrix, enforce `reviewer_id <> submitter_id` and role separation inside database transactions, and test every role/action pair against service-role-backed APIs.

9. **Critical — late payment semantics are missing.** A live-seat hold can expire before an authenticated credit-card callback, and an ATM callback can arrive after local cancellation; rejecting either callback leaves money received without fulfillment or refund ([current hold logic](/Users/seniorlifepr/Documents/線上課程平台/supabase/migrations/20260720161824_phase_three_live_courses.sql:168)).  
   **Fix:** Define an explicit order state machine including `expired`, `paid_unfulfilled`, `refund_pending`, and `reconciled`, always record valid late payments, then atomically fulfill, transfer, or queue an automatic refund with an alert.

10. **Critical — B2C electronic invoicing is unspecified.** The existing invoice client requires a Taiwanese business number and implements the enterprise invoice shape, while consumer invoices need defined carrier/donation/print/buyer-tax-ID choices and immutable snapshots ([invoice client](/Users/seniorlifepr/Documents/線上課程平台/src/lib/ecpay-invoice.ts:276)).  
    **Fix:** Add a complete B2C invoice data model and checkout UX, provider mappings for every supported invoice disposition, validation/rounding rules, and production-like issue/void/allowance reconciliation tests.

11. **High — refunds do not fully revoke downstream access.** Revoking an entitlement does not invalidate an already-issued Stream token or Zoom signature, close active playback leases, cancel bookings/reminders, or prevent an in-flight completion/export job.  
    **Fix:** Make refund finalization an atomic revocation workflow that closes leases, suppresses notifications/jobs, cancels bookings, revokes certificates, blocks new tokens, and bounds unavoidable issued-token exposure with a documented maximum TTL.

12. **High — “one-time signed download link” is a false assumption if implemented with Supabase Storage URLs.** Storage signed URLs are reusable until expiry and generally cannot be individually revoked ([Supabase Storage](https://supabase.com/docs/guides/storage/serving/downloads)).  
    **Fix:** Serve sensitive exports through an authenticated application endpoint backed by a hashed capability row that is atomically consumed once, rather than exposing a direct Storage signed URL.

13. **Critical — the Zoom host path is absent.** The plan creates meetings and issues learner signatures but never explains how an authorized instructor starts them; Zoom requires a role-1 signature plus the host’s ZAK token ([Zoom Meeting SDK requirements](https://developers.zoom.us/docs/meeting-sdk/web/client-view/meetings-webinars/)).  
    **Fix:** Add an instructor/host console with explicit authorization, role-1 signature and short-lived ZAK issuance, host readiness checks, waiting-room policy, and an operational fallback host.

14. **High — a Zoom participant signature is replayable and not learner-bound.** The current signature contains meeting number and role but no booking or user identity, so `customerKey` provides webhook correlation rather than admission security ([signature code](/Users/seniorlifepr/Documents/線上課程平台/src/lib/zoom.ts:138)).  
    **Fix:** Enable meeting registration and bind each booking to a unique Zoom registrant token (`tk`) or equivalent participant credential, plus a single active join lease and duplicate-participant reconciliation.

15. **High — the ten-minute presence rule remains bypassable without a durable global counter.** The current implementation credits a short segment when playback ends, so repeatedly ending before 600 seconds can avoid every challenge; the plan does not explicitly replace that behavior ([heartbeat route](/Users/seniorlifepr/Documents/線上課程平台/src/app/api/progress/heartbeat/route.ts:244)).  
    **Fix:** Persist `next_challenge_at_seconds` per enrollment/version, generate challenges atomically across sessions, lessons, reloads, and device takeovers, and never auto-credit an unfinished interval merely because playback ended.

16. **High — accreditation expiry has no automatic commerce transition.** The plan models `expired` but does not require checkout to stop at the approved validity boundary, potentially selling an expired credit course until an administrator notices.  
    **Fix:** Add a scheduled transition plus a database checkout guard based on accreditation validity timestamps, with automatic sale suspension, affected-user notification, and versioned renewal handling.

17. **High — the raw-event volume and retention design are missing.** At 500 concurrent viewers, 15-second heartbeats produce roughly 2,000 events per minute before live events, yet the plan retains learning evidence for seven years without partitioning, archival, purge, or storage-cost targets.  
    **Fix:** Define a volume budget and retention matrix, partition append-only events by time/course, archive immutable evidence, test recomputation across partitions, and include Storage/backups/exports in deletion and legal-hold procedures.

18. **High — monitoring only mentions failures, not silent loss or invariant drift.** A provider that stops sending webhooks, a stuck outbox, or a ledger whose event sum disagrees with lots may emit no explicit error.  
    **Fix:** Specify SLOs and alerts for webhook silence, callback age, outbox age/depth, payment-without-entitlement, invoice ambiguity, seat/point invariants, recomputation drift, and cron freshness, each with an owner and runbook.

VERDICT: REVISE

### Codex's response

採納 18 項問題並修訂 `PLAN.md`。唯一不照字面採納的是第 9 項的「自動退款」：使用者已明確鎖定人工退費，因此改為永遠記錄晚到款項、進入 `paid_unfulfilled → refund_pending / transfer_pending → reconciled`，由財務在有 SLA 與告警的異常佇列核准實際退款；其餘晚到付款狀態機與補償流程完整採納。

## Round 2 — Codex

The revision substantively addresses all 18 prior findings; I would not reopen them. Remaining and newly introduced material issues:

1. **Immediate revocation is still not guaranteed.** Session revocation does not invalidate an already-issued Supabase JWT, so blocked identities or demoted staff may retain direct RLS access for up to the token lifetime; `app_metadata` is equally stale ([plan](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:40), [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)).  
   **Fix:** Make restrictive RLS query an authoritative active-alias/role table, validate `session_id` for sensitive operations, and set a documented short JWT lifetime rather than relying on session revocation alone.

2. **Learner account recovery is absent.** A recycled/lost phone number or revoked LINE account can either strand permanent purchases and certificates or let a new phone owner attempt takeover, while contact Email is explicitly not a login method.  
   **Fix:** Add a high-assurance phone/LINE replacement workflow with old-factor confirmation where possible, manual dual approval otherwise, cooldown, notifications to every old channel, session revocation, and takeover audit.

3. **Camera attendance is overstated as trustworthy evidence.** Zoom SDK video state is read in browser code, and the learner can call the heartbeat endpoint directly with `camera_on=true`; a Zoom join webhook proves meeting presence but not the submitted camera state ([plan](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:93), [Zoom participant events](https://developers.zoom.us/docs/meeting-sdk/web/client-view/participant-events/)).  
   **Fix:** Label this evidence as client/device-reported, add anomaly and instructor-review controls, and make written regulator acceptance of that assurance level a launch blocker if camera attendance determines credit.

4. **Cancellation and rescheduling notifications are missing.** Automated notifications cover only purchase results and scheduled reminders, so a changed or canceled live class may not generate an immediate message; Email also is not attempted when both LINE and SMS fail ([plan](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:123)).  
   **Fix:** Add mandatory cancellation/reschedule/refund-choice events keyed by schedule revision and cascade LINE → SMS → Email until one channel succeeds or the delivery reaches an alerted dead-letter state.

5. **Time partitioning conflicts with global event idempotency.** Existing live events require globally unique `source_event_id`/`event_key`, but PostgreSQL cannot enforce such uniqueness across monthly partitions unless the partition key is included ([schema](/Users/seniorlifepr/Documents/線上課程平台/supabase/migrations/20260720161818_initial_learning_platform_schema.sql:243), [PostgreSQL limitation](https://www.postgresql.org/docs/17/ddl-partitioning.html)).  
   **Fix:** Keep a small unpartitioned deduplication registry keyed by provider/session event ID, or design deterministic partition-aware keys and prove cross-boundary replay safety before partitioning.

6. **Deletion, immutable archives, and managed backups remain contradictory.** Individual records cannot be synchronously removed from historical PITR/daily backups, and an immutable event archive cannot also support arbitrary subject deletion without a cryptographic strategy ([plan](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:142), [Supabase backup retention](https://supabase.com/docs/guides/platform/backups)).  
   **Fix:** Define primary-data deletion, archive anonymization or crypto-shredding, backup age-out windows, and mandatory tombstone replay after restoration instead of promising synchronous backup deletion.

7. **Completion and certificate issuance are not serialized.** Heartbeat, exam submission, identity approval, attendance recomputation, and refund can concurrently evaluate completion and create or revoke conflicting certificate revisions ([plan](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:114)).  
   **Fix:** Put final completion evaluation and certificate/outbox creation in one enrollment-locking RPC with an entitlement recheck, transition compare-and-set, and a unique active certificate revision constraint.

8. **The live kill switch contradicts paid-user continuity.** Stopping “new admission” necessarily blocks an already-paid learner who has not joined yet, despite the same sentence promising paid learners are unaffected ([plan](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:138)).  
   **Fix:** Separate commerce, assignment, and emergency admission switches, and define the notification, transfer, and refund obligations whenever the admission switch blocks a paid booking.

9. **Contact-Email verification remains underspecified.** A short code protected only by an ordinary hash is cheaply recoverable offline and the plan gives no attempt counter, supersession, or one-use rule ([plan](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:35)).  
   **Fix:** Store a keyed HMAC of a random or sufficiently strong code, allow one active challenge per address/person, cap attempts, atomically consume it, and rate-limit by person, Email, and IP.

10. **B2B point returns around expiry are ambiguous.** Normal cancellation credits the original expiry, while provider cancellation extends lots that are “about to expire” by an undefined threshold; concurrent expiry, refund, allocation release, and extension have no stated precedence ([plan](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:96)).  
    **Fix:** Define exact expiry-boundary and extension rules, lock every affected lot in deterministic order, and emit one idempotent ledger event for each release/expiry/extension outcome.

11. **“Prevent video download” remains an impossible absolute guarantee.** Signed Stream access prevents unauthenticated playback but cannot stop an authorized browser from saving delivered segments or recording the screen.  
    **Fix:** Specify this as disabling official download paths plus short-lived signed playback, or add DRM/forensic watermarking if actual copy resistance is required.

VERDICT: REVISE

### Codex's response

採納全部 11 項。依使用者原意，「禁止下載」定義為產品不提供下載／離線路徑並以短效簽章降低未授權存取，不誤稱能阻止已授權瀏覽器錄製螢幕；第一版不擴張成 DRM。其餘新增 authoritative role／alias 查核、帳號復原、client-reported 鏡頭證據揭露、通知事件、全域去重 registry、crypto-shredding／tombstone、發證鎖、分層 kill switch、Email challenge、點數到期優先序。

## Round 3 — Codex

The revision addresses all eleven prior findings, but four material issues remain:

- **Critical — Notification fallback is based on provider acceptance, not delivery:** [PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:127) stops after LINE “success,” but LINE may return HTTP 200 for blocked, deleted, or non-friend users without delivering the message. [LINE documents this behavior](https://developers.line.biz/en/reference/messaging-api/nojs/).  
  **Fix:** Treat LINE 200 only as acceptance; for cancellation, rescheduling, and payment events, also send through a verified SMS/email channel or use a delivery-capable fallback rule.

- **High — The global dedup registry recreates the scaling bottleneck:** [PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:146) sends every high-frequency heartbeat through an unpartitioned table, giving it the same growth and write contention the event partitions were meant to avoid; registry and payload inserts can also diverge unless atomic.  
  **Fix:** Reserve the registry for low-volume webhooks, deduplicate heartbeats with per-session monotonic sequence/CAS, and insert dedup state plus payload in one transaction.

- **Critical — Restore-time deletion replay has no survivable source of truth:** [PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:147) does not say the tombstone ledger lives outside the restored database, so restoring to a point before deletion can restore both the personal data and a state where its tombstone never existed; additionally, the per-person crypto-shredding key hierarchy is absent from the encryption design at [line 37](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:37).  
  **Fix:** Keep deletion manifests in a separate non-restored control plane, gate every restore on replaying them, and define per-person DEKs wrapped by versioned KEKs—including treatment of linkable relational identifiers.

- **High — The decision summary still contradicts the normative design:** It promises absolute download prevention ([line 172](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:172) versus line 69), limits email fallback to users without phones ([line 174](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:174) versus line 127), and describes only three switches ([line 169](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:169) versus the per-business-line switch matrix at line 141).  
  **Fix:** Rewrite the summary so every decision exactly matches the detailed approach and cannot serve as a competing implementation specification.

VERDICT: REVISE

### Codex's response

採納全部 4 項：LINE provider acceptance 不再視為送達，關鍵交易／直播異動改採獨立已驗證管道冗餘；全域 dedup registry 僅處理低頻 webhook，heartbeat 使用 session sequence CAS；刪除 manifest 移到獨立控制面並補齊 per-person DEK／versioned KEK；同步修正 Key decisions，避免摘要成為互相矛盾的第二份規格。

## Round 4 — Codex

All four prior blockers are addressed: delivery semantics, heartbeat deduplication, external tombstone replay/per-person keys, and summary consistency.

New material issues:

- **Critical — Accreditation expiry leaves existing learners undefined:** [PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:52) stops new sales at expiry but does not decide whether an existing learner completing afterward earns points; the completion RPC’s “version conditions” and PDF snapshot could either reject valid learners or issue expired accreditation ([lines 116–117](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:116)).  
  **Fix:** Define the authoritative eligibility date—purchase, enrollment, course session, or completion—and specify grace-period, transfer/refund, PDF, and submission behavior for every expiry transition.

- **High — Zoom Component View conflicts with the mobile-first requirement:** The plan mandates Component View ([line 88](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:88)) while requiring iPhone and Android support ([line 162](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:162)); Zoom says Component View is desktop-oriented and directs mobile use cases to Client View. [Zoom Meeting SDK documentation](https://developers.zoom.us/docs/meeting-sdk/web/).  
  **Fix:** Select Client View on mobile and Component View on supported desktop browsers, then test registration-token joining, camera telemetry, and reconnection in both modes.

- **High — Host licensing is checked per meeting, not across overlapping meetings:** Primary/fallback hosts are assigned, but no host-resource reservation prevents concurrent sessions from exceeding that user’s Zoom concurrency allowance; common licenses permit only one or two simultaneous meetings. [Zoom concurrency limits](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0068522).  
  **Fix:** Model licensed hosts and concurrency limits, atomically reserve primary/fallback capacity across buffered time ranges, reject conflicting publication, and test overlapping-session failover.

VERDICT: REVISE

### Codex's response

採納全部 3 項。錄播以完成時間、直播以正式場次時間作積分資格日期；不得自行用 grace period 超過官方核定期限，逾期既有學員走通知、轉課／全退或非積分完成證明。手機採 Client View、支援的桌面採 Component View。Zoom host 另建授權容量與含緩衝時段的 primary／fallback 預留，場次發布前即阻擋重疊超額。

## Round 5 — Codex

The three prior blockers are addressed, but the revisions expose three new material problems:

- **Critical — Accreditation approval conflicts with immutable course versions:** [PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:22) makes published versions immutable, yet an `applying` version can already be sold and must later acquire approval number, points, and validity dates ([lines 51–54](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:51)); mutating it violates immutability, while creating a new version strands existing enrollments on the pending version.  
  **Fix:** Model accreditation decisions as separate append-only revisions linked to course versions, then batch-classify existing enrollments and supersede PDFs without mutating the published content version.

- **High — Expiry remediation ignores who funded the enrollment:** [Line 54](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:54) lets the learner choose transfer or full refund, but a B2B learner neither owns the purchasing organization’s money nor controls the consumed point allocation, and expired source lots need explicit compensation treatment.  
  **Fix:** Branch remediation by funding source: B2C refunds the payer, while B2B requires organization-authorized transfer or idempotent point restoration/compensation to the original allocation components.

- **High — Zoom reservations protect publication but not later mutations:** [Line 92](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:92) reserves host capacity initially, but rescheduling and license downgrade only trigger revalidation/alerts; they do not atomically replace reservations or stop further booking when capacity becomes invalid.  
  **Fix:** Route every time, host, and license change through a locking saga that reserves replacement capacity before releasing the old range and marks unresolved sessions non-bookable until Zoom and local state reconcile.

VERDICT: REVISE

### Codex's response — MAX_ROUNDS reached

同意三項都是實質問題，但 MAX_ROUNDS=5 已達上限，依技能規則不再自行宣稱收斂，交由使用者裁決。建議立場如下：

1. 採納獨立 append-only `accreditation_decision_revision`，課程內容版本保持不可變；核定、展延、退件只新增 decision revision，既有 enrollment 依決定批次分類，PDF 用 superseding revision，不回寫舊內容版本。
2. 採納依付款來源分流：B2C 的付款人選轉課／退款；B2B 由 organization owner／manager 決定，點數依原 allocation components 做冪等 restoration，原 lot 不可用時建立既定 90 天 compensation lot，學員只能查看與回應課務安排，不能處分機構款項。
3. 採納 Zoom mutation saga：改時間、改 host、授權降級都先鎖定並取得 replacement reservation，再釋放舊預留；若無法完成，場次進 `capacity_conflict` 且停止新 booking，既有付費 booking 進通知、轉場／退款處理，直到 Zoom 與本地狀態對帳完成。

### Human resolution — 2026-07-23 Asia/Taipei

使用者明確回覆「同意三項修正，並開始製作」。三項修正已併入 `PLAN.md`，人工解除 MAX_ROUNDS 僵局；Act 3 可在 clean-tree gate 通過後開始。
