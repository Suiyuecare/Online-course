# Plan Review Log: 歲悅學苑乾淨重建與三線正式收費平台
Act 1 (grill) complete — plan locked with the user. MAX_ROUNDS=5.

## Round 1 — Codex

唯讀審查完成；目前仍有多個實作級阻斷問題。

1. 「可回復發布」與原地清除 Production Supabase、又不保留舊資料互相矛盾；baseline 失敗後只能繼續修，無法可靠 rollback（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:21)）。

   Fix: 改採全新 Supabase project 藍綠部署，完成 restore/UAT 後切換 Vercel 與網域，再經人工批准刪除舊 project。

2. Git checkpoint 並未涵蓋目前工作樹：現有 120 個修改、1 個刪除、96 個未追蹤項目，而且 origin 是 `Suiyuecare/Suiyuecare-online-course.git`，不是計畫中的 `Suiyuecare/Online-course.git`。

   Fix: 清除前將精確工作樹提交並簽 tag，鏡像至目標 repository、驗證 commit SHA 與 branch protection，再開始重建。

3. reset 只處理資料庫物件，未涵蓋 Supabase Auth Dashboard、redirect allowlist、Vercel secrets、Cron、provider webhook、Cloudflare assets、Zoom meetings 與已發行 credentials；現有設定仍包含 LINE、ECPay 與萬用 Preview redirect（[.env.example](/Users/seniorlifepr/Documents/線上課程平台/.env.example:4)、[config.toml](/Users/seniorlifepr/Documents/線上課程平台/supabase/config.toml:151)）。

   Fix: 增加 control-plane 清冊與逐項停用、刪除、輪替及事後驗證程序，並以 provider API 而非 SQL 刪除 Storage objects；Supabase 明確要求將 Storage metadata 視為唯讀。[Supabase 文件](https://supabase.com/docs/guides/storage/schema/design)

4. Phone OTP-only 無法防止回收門號的新持有人直接登入舊帳號；客服雙人核准只限制管理員，並未定義申請人的身分證明，而且 learner Email 是選填。

   Fix: 對既有敏感帳號加入 passkey／離線 recovery code 或高保證人工重驗，並在新裝置、長期未登入或復原案件完成前封鎖舊資料存取。

5. 「手機只存在 Supabase Auth」與尚未註冊者的手機邀請直接衝突，因為邀請必須先保存並比對目標號碼（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:120)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:284)）。

   Fix: 為 invitation 建立正規化版本、加密電話、獨立 blind index 與接受／撤銷／到期後刪除期限。

6. Bootstrap 只升級第一位 platform admin，但後續新增高權限又要求雙人核准，第二位 admin 的建立路徑形成先有雞還是先有蛋；兩人同時失去 TOTP 時也沒有復原出口。

   Fix: Bootstrap 必須一次性綁定並建立兩位預先核實且已註冊 TOTP 的管理員，另設離線雙人保管的 break-glass 流程。

7. Turnstile 若只放在 Next.js route，可被直接呼叫公開 Supabase `/auth/v1/otp` 端點繞過；目前 Supabase CAPTCHA 設定也是停用的（[config.toml](/Users/seniorlifepr/Documents/線上課程平台/supabase/config.toml:206)）。

   Fix: 在 Supabase Auth 層強制驗證 Turnstile、啟用 Auth hook/rate limit、Twilio spend cap，並加入直接呼叫 Auth endpoint 的濫用測試。[Supabase Phone Auth 文件](https://supabase.com/docs/guides/auth/phone-login)

8. 人工匯款模型沒有處理逾期入帳、少匯、多匯、拆單匯款、合併匯款、無訂單匯款與 finance 輸錯 reconciliation reference；唯一自由文字 reference 不能證明同一筆銀行入帳未被重複分配。

   Fix: 建立不可變 `bank_transactions` 與多筆 allocation/remediation ledger，以銀行流水指紋、累計分配額及未認領餘額作資料庫約束。

9. 訂單只有 `refunded` 終態，無法表達 partial、rejected、cancelled、disbursement_failed 或多次退款；單一 `allowance_issued` 同樣無法處理多次部分折讓。

   Fix: 將 refund allocations、disbursements 與 invoice allowances 建模為子紀錄，以累計金額約束推導 `partially_refunded/refunded`，不要把退款生命週期塞進單一 order 狀態。

10. 退款直到實際付款完成才撤銷 entitlement，學員可在退款金額計算後繼續觀看或參加直播，造成退款比例與實際履約不一致（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:193)）。

    Fix: 受理／核准退款時在同一交易凍結 entitlement、lease、booking 與使用量快照，駁回時才以明確事件恢復。

11. 計畫聲稱最差遺失約 24 小時資料，但 Storage 只每週備份；Supabase daily backup 不包含實際 Storage objects，因此付款證明、證件附件與 PDF 的 RPO 可接近七天。

    Fix: 對 Storage 做每日增量、版本化、含 checksum manifest 的異地備份並實測一致性還原，或明確揭露不同的七日 RPO。[Supabase 備份文件](https://supabase.com/docs/guides/platform/backups)

12. Per-person DEK crypto-shred 無法刪除散落在 certificate PDF、Excel export、notification payload、provider、Storage 與離線備份中的明文副本；KEK 若只存在 Vercel secret，專案遺失又會使所有備份永久不可解。

    Fix: 建立完整資料複本／金鑰依賴圖，所有敏感 artifact 各自 envelope-encrypt，KEK 使用受稽核 KMS 與雙人復原，tombstone replay 必須涵蓋每個副本。

13. 「append-only」不等於不可竄改；service role、migration owner 或 DB 管理員仍可更新／刪除 audit rows，而事件依 retention 刪除後又無法重算 summary。

    Fix: 使用獨立 owner、撤銷直接 DML、僅允許 `SECURITY DEFINER` append、交易內 fail-closed 寫 audit，並定期輸出簽名 hash checkpoint 與可驗證封存。

14. Zoom 可售容量直接允許 200 位學員，卻沒有為 host、co-host、助理及支援人員保留名額；Zoom 的 meeting capacity 是整場總容量，助理缺席時也沒有開課阻斷規則。[Zoom 容量文件](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0068002)

    Fix: 定義 `learner_capacity = verified_zoom_capacity − host − assistants − reserved_support`，並在入場前重新驗證實際到場助理，不足時限制入場或啟動取消／退款 SOP。

15. 「交易鎖定 host capacity，再呼叫 Zoom」可能在網路呼叫期間持有 DB lock；同時，DB 的單一 join lease 也不會自動踢除已加入 Zoom 的舊裝置。

    Fix: 先提交具期限的 pending reservation，再呼叫 Zoom 並以 CAS 完成 saga；lease 接管時必須使舊 token 失效並透過 Zoom API/webhook 驅逐或標記重複 participant。

16. 直播出席的分母、實際開課／提早結束、休息區段可否事後修改、延遲及亂序 webhook 的結算期限均未定義，管理員事後增加休息即可提高所有人比例。

    Fix: 場次開始時凍結規則，實際 start/end/break 只新增不可變事件，按 meeting UUID 處理亂序資料，經固定 grace period 後結算且後續只能雙人 correction。

17. Cloudflare signed URL 只做存取授權，不能自行加入每位學員的姓名／訂單浮水印；Stream watermark profile 是上傳時套用的靜態圖像。

    Fix: 將需求改成「signed playback token＋可移除的 client overlay」，或另行採購真正 per-viewer server-side forensic watermark，勿把它列為 Stream signed URL 能力。[Cloudflare signed URL](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/)、[watermark API](https://developers.cloudflare.com/stream/manage-video-library/bindings/)

18. Hybrid prerequisite graph 沒有規定 cycle、跨版本節點、孤兒節點與不可完成路徑檢查；換場也未說明如何原子取得新座位後再釋放舊座位。

    Fix: 發布時執行版本內 DAG／可達性驗證，換場使用固定 lock order 的單一交易先鎖新場容量再撤銷舊 booking。

19. `approved/expired/revoked` 缺少生效日、是否溯及既往及對 paid、active、completed、submitted、credited 各狀態的處理矩陣，也沒有依核定到期日阻止明顯來不及完成的銷售。

    Fix: 為每個 accreditation revision 定義 effective interval、retroactivity、受影響狀態矩陣與各課型最晚可售／可指派日期。

20. payment proof、身分補件、課程附件與企業 Excel 都是攻擊面，目前只有 private bucket/hash，沒有 magic-byte、壓縮炸彈、惡意 PDF/Office、檔案大小及下載內容處置。

    Fix: 所有上傳先進 quarantine，限制 MIME／magic bytes／大小／展開比、執行惡意程式掃描與 metadata 清除，通過後才移至可讀 bucket。

21. AAL2 JWT 只代表本次 session 曾完成 TOTP，不保證敏感操作前五分鐘重新驗證；全域 sign-out 後既有 access JWT 在到期前也仍可能有效。

    Fix: Step-up grant 必須來自新的 TOTP challenge 並保存 verified-at，所有敏感 RPC 同時檢查一次性 grant 與資料庫 session/identity epoch。

22. 營運 dashboard、jobs 與告警大多仍依賴同一個 Supabase/Vercel 系統；資料庫、Cron 或登入整體故障時，內部 dashboard 本身也會消失。

    Fix: 增加外部 synthetic checks、獨立告警接收器、provider freshness SLO 與定期 dead-man signal，並在 UAT 實測整個主系統不可用的事故路徑。

VERDICT: REVISE

### 主代理的回應

- 採納第 3–22 項，已補入：
  - Supabase／Vercel／Auth／Storage／provider 的 control-plane 清冊、停用、輪替與驗證。
  - 回收門號 restricted mode 與高保證人工重驗；邀請電話加密＋blind index＋到期刪除。
  - 兩位管理員一次性 bootstrap、離線雙人 break-glass、Auth 層 Turnstile／hook／spend cap。
  - 不可變 bank transaction＋allocation ledger，處理少匯、多匯、拆單、合併、逾期及無訂單款。
  - refund／disbursement／allowance 子紀錄、退款受理即凍結使用權與多次部分退款上限。
  - Storage 每日增量備份、PII copy／key dependency map、managed KMS／雙人復原、tombstone 全副本 replay。
  - 獨立 event owner、fail-closed audit、簽名 hash checkpoint。
  - Zoom 總容量扣除 host／assistant／support、助理到場檢查、短交易 reservation saga、舊 participant 驅逐。
  - 不可變直播 denominator、24 小時 evidence settlement、client overlay 能力邊界。
  - Hybrid DAG／可達性檢查、先鎖新位再釋放舊位。
  - Accreditation effective／retroactive／paid-active-completed-submitted-credited 影響矩陣及最晚可售日期。
  - 全上傳 quarantine／magic-byte／zip-bomb／malware／metadata 防護。
  - fresh TOTP step-up＋identity/session epoch，以及外部 synthetic check／獨立告警／dead-man signal。
- 不採納第 1 項「另建全新 Production Supabase project」。使用者已明確指定沿用 `eswdhynrbzrjgetnmhit` 並接受清空不備份；改為明示 reset 後無 rollback，所有流程先在 local／test 演練，正式失敗時維持 maintenance、只重跑冪等 migration 或 forward-fix。
- 不採納第 2 項「提交／簽 tag／鏡像目前工作樹」。使用者已明確要求舊應用與未完成修改不用備份、可直接乾淨重建；保留既有 Git checkpoint，另保存工作樹路徑／狀態清單作執行證據，但不讓舊程式重新成為規格來源。

## Round 2 — Codex

上一輪大多數問題已處理；藍綠部署與工作樹備份則被明確列為使用者接受的不可逆取捨，不再視為未揭露風險。但仍有以下實作阻斷點。

1. `restricted mode` 尚未明確進入 RLS／Storage policy；回收門號持有人取得原 `auth.uid()` 後，仍可能直接呼叫 PostgREST 讀取「自己的」舊資料，繞過 Next.js（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:91)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:356)）。

   Fix: 所有 learner-sensitive RLS、RPC、Storage download 與 certificate endpoint 都必須檢查 active identity、restricted status 及 identity epoch，或完全撤銷 browser 對敏感表的直接權限。

2. 清除流程缺少無競爭的 write fence：零資料檢查後、reset 前或 baseline 尚未完成時，Auth signup、舊 Cron 或 webhook 仍可能新增 user/event，產生孤兒資料。

   Fix: 先部署不依賴 DB 的 maintenance release、停用 Auth signup與舊 Cron/webhook、撤銷舊寫入 credentials並排空工作，再執行最終零資料斷言；baseline與新應用驗證完成前保持封鎖。

3. Zoom Meeting SDK Web 的 `join()` 仍需要 meeting password；只有使用 waiting-room-only 且空密碼時才能不傳，registrant `tk` 並不取代 password，因此「不把 Zoom password 暴露給 client」目前不可保證（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:262)）。

   Fix: 明確固定 Production meeting 為 waiting-room-only／empty password，或承認 passcode 會短暫存在 browser memory並以 authenticated join、CSP及短生命週期降低風險。[Zoom Join 文件](https://developers.zoom.us/docs/meeting-sdk/web/component-view/meetings-webinars/)

4. DB lease epoch 無法撤銷已簽發的 Zoom SDK JWT；Zoom 規定 Web JWT 至少有效 30 分鐘，而 booking-level registrant token 也可能讓被移除的舊裝置重新加入（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:287)）。

   Fix: 改用每次 lease 專屬 registrant、接管時先在 Zoom 撤銷舊 registrant並禁止 removed participant rejoin；若 provider 無法證明撤銷成功，就在舊 JWT 到期前 fail closed。[Zoom 授權文件](https://developers.zoom.us/docs/meeting-sdk/auth/)

5. Zoom participant webhook 並未提供計畫假設的通用 provider event ID 或 monotonic sequence；官方 payload主要提供 `event_ts`、meeting UUID及 participant欄位（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:79)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:284)）。

   Fix: 使用事件類型、account、meeting UUID、participant UUID/customerKey、occurrence timestamp及payload hash組合去重，另建內部 ingest sequence但不得把它當 provider 發生順序。[Zoom Webhook schema](https://developers.zoom.us/docs/api/meetings/events/)

6. 出席分母雖已凍結，但 numerator 沒有限制在正式教學區間；學員可利用課前30分鐘、課後30分鐘或正式休息累積 presence/camera seconds（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:278)）。

   Fix: numerator 必須逐區段取 `Zoom presence ∩ heartbeat ∩ scheduled teaching window − locked breaks`，簽到退窗口只接受事件、不得增加正式秒數。

7. 「一個有效 seat reservation」沒有作用域，與混合課每個 live component 都需各保留一席直接衝突（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:298)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:362)）。

   Fix: 唯一約束應是每個 payer/member＋course version＋live component 最多一個等價場次 reservation，而非每人或每訂單全域一席。

8. 單一 finance 可以手動建立 `bank_transaction` 並立即開通 entitlement或鑄造機構點數；append-only audit只能事後發現，不能證明銀行交易真實存在（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:119)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:205)）。

   Fix: 每筆交易須綁定不可變銀行明細來源hash／附件並每日由另一人批次對帳；員工關係訂單、高額款與所有organization top-up採雙人確認。

9. 公開 certificate verification 沒有規定不可猜測的 lookup capability；若使用流水號或短碼，攻擊者可枚舉遮罩姓名、課程、日期與積分（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:256)）。

   Fix: QR使用至少128-bit隨機驗證token、只存hash、constant-shape not-found response、嚴格rate limit且禁止搜尋引擎索引。

10. Retention 允許刪除原始 playback/live events，但完課規則仍承諾 summary 可由原始事件重算；刪除後哪一份資料成為權威尚未決定（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:80)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:227)）。

    Fix: 將具manifest/hash的可重載封存明定為權威事件庫並在drop partition前驗證重算，或明確規定保存期後改由簽名eligibility/certificate snapshot成為權威。

VERDICT: REVISE

### 主代理的回應

- 採納第 1–7、9–10 項：
  - restricted status／identity epoch 已納入 sensitive RLS、RPC、Storage、certificate、Stream／Zoom endpoint；敏感表撤銷 browser 直接 SELECT。
  - reset 前新增不依賴舊 DB 的 maintenance write fence，先停 Auth signup、Cron／webhook 與舊 credentials，排空後才做最終零資料斷言。
  - 承認 Zoom join passcode 會短暫存在 browser memory；以 authenticated response、CSP、waiting room、registration 與禁止持久化控制，不再宣稱完全不送 client。
  - 每個 join lease 使用獨立 registrant；撤銷／移除舊 participant 未確認前，新 lease 在舊 JWT 到期前 fail closed。
  - Zoom dedup 改用 event type／account／meeting UUID／participant／timestamp／payload hash；內部 ingest sequence 不冒充 provider 順序。
  - 正式 numerator 限制為 presence、fresh heartbeat、scheduled teaching window 的交集並扣除 locked breaks；簽到退窗口不計時。
  - seat uniqueness 改為 payer/member＋course version＋live component；Hybrid 可為不同 component 各占一席。
  - QR 使用 128-bit 隨機 token hash、constant-shape response、rate limit、noindex。
  - 保存期內可重載封存是權威事件庫；drop partition 前重算驗證；保存期屆滿刪除後改由 signed eligibility／certificate snapshot 作歷史權威。
- 第 8 項採折衷但不保留單人任意鑄點：一般非關係人低額 B2C 仍遵守使用者已鎖定的「一位授權財務可確認單筆匯款」；每筆仍須綁定不可變銀行來源 hash，並由另一人每日批次對帳。所有 organization top-up、關係人及高額款在開權限／鑄點前改採雙人確認；高額門檻未設定時 organization top-up fail closed。

## Round 3 — Codex

上一輪的十項問題均已實質處理，但本輪仍發現六個具體衝突。

1. Host console 無法在「ZAK 永不送 client」下啟動會議；Zoom Web SDK 的 role-1 host flow 必須把 ZAK 傳給瀏覽器中的 `client.join()`（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:265)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:266)）。

   Fix: 承認 host ZAK 會短暫存在隔離的 host browser memory，要求 fresh-TOTP、嚴格 CSP／Trusted Types、無第三方 scripts、不持久化，並在使用後立即清除。[Zoom 授權文件](https://developers.zoom.us/docs/meeting-sdk/auth/)

2. 每個 join lease 建立獨立 Zoom registrant，但 learner Email 是選填；Zoom registration 與 Meeting SDK registered join 需要 Email，現有流程無法為無 Email 學員建立 registrant（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:290)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:350)）。

   Fix: 為每個 lease 產生唯一、不可回推身分的受控 synthetic Email並停用 Zoom寄信，或將已驗證 Email列為直播課必要條件。[Zoom Registrant API](https://developers.zoom.us/docs/api/meetings/)

3. 通用 webhook 規則仍要求 Zoom `event ID`，與 Zoom 專節明確承認其沒有通用 event ID 相矛盾（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:80)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:269)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:364)）。

   Fix: 將通用規則改成「有 provider-native ID 時使用，否則使用已定義的 canonical event fingerprint」，避免實作者為 Zoom捏造不可靠 ID。

4. 高額門檻未設定時只讓 organization top-up fail closed，但 organization top-up 本來就全部雙人核准；真正失去保護的是高額 B2C款項（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:207)）。

   Fix: 高額門檻未設定時，所有 B2C付款一律要求雙人確認或關閉 `b2c_commerce`，而非只封鎖 organization top-up。

5. 平台事故可只退款受影響 component，但退款流程一律凍結並撤銷整個 entitlement，會錯誤移除學員仍保留且已付款的混合課部分（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:151)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:213)）。

   Fix: Refund allocation 必須明確綁 order item／component；凍結、撤銷、booking取消與資格重算都按退款scope執行，只有整筆終止才撤銷整門課 entitlement。

6. Secrets 被宣告「只存在 Supabase／Vercel」，但 KEK 同時要求 managed KMS 與離線雙人備份，兩項規則會導致實作者選錯金鑰保管位置（[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:40)、[PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:129)）。

   Fix: 將秘密保管矩陣明文化：一般 runtime secrets在Vercel／Supabase，KEK在managed KMS，僅加密 escrow副本可離線雙人保管。

VERDICT: REVISE

### 主代理的回應

- 六項全部採納：
  - Host console 改為隔離頁面；ZAK 在 fresh-TOTP 後只短暫存在 host browser memory，套用嚴格 CSP／Trusted Types、無第三方 scripts、不持久化並於 join 後清除。
  - learner Email 維持選填；每個 Zoom lease 使用受控網域下不可回推本人的 128-bit random synthetic Email，關閉 Zoom mail／catch-all。
  - 通用 webhook 規則改為 native event ID 或 adapter canonical fingerprint。
  - 高額門檻未設定時 `b2c_commerce` fail closed；organization top-up 永遠雙人確認。
  - Refund allocation 綁 order item／component／whole-order scope；只凍結與撤銷相同 scope，保留其他已付款內容，whole-order 才撤銷整門 entitlement。
  - Secret matrix 明確區分一般 runtime secret、managed-KMS KEK 與離線加密 escrow 副本。

## Round 4 — Codex

All six prior material findings are addressed:

- Host ZAK exposure is explicitly isolated and short-lived.
- Email-optional learners receive non-identifying synthetic Zoom addresses.
- Webhook deduplication supports providers without native event IDs.
- Missing high-value thresholds now fail closed for B2C.
- Refund freezing and revocation are component-scoped.
- Runtime secrets, KMS keys, and offline escrow have distinct custody rules.

One new, non-blocking ambiguity: [PLAN.md](/Users/seniorlifepr/Documents/線上課程平台/PLAN.md:271) and its test at line 411 prohibit all third-party scripts, although the Zoom SDK itself is third-party.

Fix: Prohibit only unrelated third-party scripts and explicitly allowlist pinned Zoom SDK artifacts and required Zoom origins in CSP.

No material implementation blocker remains.

VERDICT: APPROVED

### 主代理的回應

採納非阻斷文字修正：主持人 console 明確 allowlist 固定版本 Zoom Meeting SDK 與必要 Zoom origins；禁止的是 analytics 與其他不相關第三方 scripts。計畫已通過審查，不需第 5 輪。
