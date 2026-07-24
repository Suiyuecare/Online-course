# Plan: 歲悅學苑乾淨重建與三線正式收費平台
_Locked via grill — by Codex + 歲悅團隊_

## Goal

以乾淨、可稽核、手機優先的方式重建「歲悅學苑」，讓長照從業人員可購買錄播、同步直播或混合型長照積分課程，讓長照機構以點數購課並指派員工，同時提供課程、財務、客服、積分審核與平台管理後台。正式流程必須涵蓋手機驗證碼登入、人工銀行匯款核銷、Cloudflare Stream 錄播、Zoom Meeting SDK 直播、有效觀看分鐘、每 10 分鐘防掛、80 分測驗、滿意度、積分身分審核、送審匯出、證明與公開驗證。現有應用程式程式碼、舊資料表、舊 migrations、舊展示課與未符合本計畫的流程全部移除；只保留 Git、正式授權的歲悅品牌素材、網域及必要部署連結。三種課型與 B2C／B2B 在所有法遵、供應商及驗收門檻通過後同時正式開放收費。

## Approach

1. **鎖定重建邊界，安全清除舊系統**

   - 保留：
     - Git repository 與既有 checkpoint 歷史。
     - 平台名稱「歲悅學苑」、既有牛奶盒 Logo、品牌橘 `#EA880C`、奶油底色 `#FFF8ED`。
     - `class.suiyuecare.com`、指定 GitHub repository、Vercel project 及 Supabase project 的連結資訊。
     - 經歲悅確認具有使用權的圖片、影片原檔、字型及品牌素材。
   - 永久移除：
     - 現有 Next.js 頁面、API、舊測試、舊展示課、舊商業流程及未符合本計畫的元件。
     - 現有應用程式 tables、views、functions、triggers、types、policies、buckets 與 migrations。
     - LINE、綠界、信用卡、ATM 虛擬帳號、企業席次包、訂閱、舊密碼／Email 登入等已被最新決策取代的流程。
   - 不建立舊應用程式備份；這是使用者明確接受的不可逆選擇。Git checkpoint 只作程式歷史，不承諾可還原遠端資料。
   - 不為目前大量未提交／未追蹤的舊工作樹另建 commit、tag 或鏡像；只保存清除前的路徑／狀態清單作執行證據。這些舊修改已被使用者明確指定為可拋棄內容，不能重新成為新規格來源。
   - 執行任何遠端清除前，重新以唯讀方式檢查 `auth.users`、sessions、Storage objects、訂單、付款、課程、修課、學習事件與企業資料。只要任一數量不是預期的零，立即停止遠端清除並回報，不以「乾淨重建」授權推定可刪除新出現的資料。
   - 清除只針對盤點完成的 application-owned objects；保留 `auth`、`storage`、`realtime`、`extensions`、`vault`、`graphql`、`supabase_migrations` 等 Supabase 系統物件。不得用未盤點的廣域 `DROP SCHEMA ... CASCADE`。
   - 保存舊 schema／物件／migration 名單與 checksum 作為執行證據，但不保存舊業務資料。reset migration 必須同時驗證 linked project ref、預期物件 fingerprint 與零筆受保護資料；不符合即 abort。
   - 另建 control-plane 清冊，逐項處理 Supabase Hosted Auth providers／templates／redirect allowlist／CAPTCHA／hooks、Vercel environment secrets／Cron／domains、Storage buckets／objects、provider webhook endpoints、已建立的 Cloudflare assets、Zoom meetings／apps 與舊 credentials。舊 LINE／ECPay／萬用 Preview redirect 必須停用或移除；credentials 依 provider 流程撤銷／輪替。Storage objects 與 buckets 只用 Storage API 管理，不直接修改 Storage metadata table。
   - 正式 reset 前先部署一個不依賴舊 DB 的 maintenance release，形成 write fence：關閉 Auth signup、停用舊 Cron／webhooks、撤銷舊 service credentials、排空或封存既有工作。完成後才做最後一次零資料／零寫入斷言；baseline、Hosted Auth 與新應用 post-check 全部成功前不得解除 fence。
   - 在 local Supabase 完成新基線後，以 CLI `supabase migration new` 產生 reset 與職責分離的 baseline migrations：identity／RBAC／legal、catalog／graph／accreditation、manual-bank commerce、recorded learning／exam、live／hybrid、enterprise points、certificates／exports／retention、operations／notifications、RLS／grants／bootstrap。不得手寫或重用已套用 timestamp。
   - 遠端舊 migration history 只透過官方 `supabase migration repair --status reverted` 對齊，不直接修改 history table；先 `db push --dry-run`，再經人工批准正式套用。若 repair 完成但 push 失敗，網站維持 maintenance，重跑可冪等的 push，不開放流量。
   - 新 schema 套用後只建立平台設定、角色與草稿範本，不建立可販售課、假訂單、假學員或示範積分紀錄。

2. **建立隔離環境與 forward-fix 發布方式**

   - 目標 runtime 為 Node.js 22＋Next.js App Router。程式依 `domain`（純狀態機／金額／出席規則）、`application`（use cases）、`infrastructure`（Supabase／Twilio／Resend／Stream／Zoom／manual-bank adapters）與薄 `app` routes／role UI 分層；Production 不提供靜態 demo fallback。
   - 環境固定為：
     - Local：本機 Supabase、固定測試手機／OTP、mock bank／Stream／Zoom／SMS／Email。
     - Test／Preview：獨立 Supabase branch 或測試 project、供應商 sandbox credentials、Vercel Preview。
     - Production：`class.suiyuecare.com`、正式 Supabase、正式供應商 credentials。
   - Local／Preview 絕不取得 Production service-role secret、PII encryption key、Twilio、Zoom、Cloudflare 或 Resend production key。
   - Secret 保管矩陣：
     - 一般 runtime secrets（Supabase service secret、Twilio／Resend／Stream／Zoom credentials、webhook／Cron secrets）存於 Vercel／Supabase server-side secret storage。
     - PII KEK 存於受稽核 managed KMS，應用程式只取得最小 KMS 使用權，不把 raw KEK 存成 Vercel env。
     - 只有 KEK 的加密 escrow 副本可由兩位不同保管人離線共同保存／復原。
     - 所有 secret 都不得進 Git、不得使用 `NEXT_PUBLIC_` 前綴、不得寫入 log。
   - 使用向前 migration；正式 schema 變更先通過 local reset、test project migration、RLS 整合測試與 production dry-run。資料庫 migration 與 Vercel release 分成相容的 expand／deploy／contract 步驟，避免部署回滾時程式與 schema 不相容。
   - 依使用者決策沿用既有 Production Supabase project，不另建藍綠 Production project，也不承諾 reset 後可以 rollback 到舊應用。reset 前靠 local／test 完整演練；reset 開始後若 baseline 失敗，Production 維持 maintenance，只能重跑冪等 migration 或 forward-fix，直到新基線驗證成功。
   - 使用獨立 feature switches：
     - `b2c_commerce`
     - `organization_topup`
     - `organization_assignment`
     - `recorded_playback`
     - `live_booking`
     - `zoom_join`
     - `hybrid_completion`
     - `accreditation_export`
     - `certificate_issue`
   - 首次公開上線時三種課型與 B2C／B2B 必須一起達標後才開放；上線後各開關可獨立緊急暫停。暫停只能阻止新操作，不刪除已付款、學習、出席或稽核資料。

3. **建立權威資料模型、狀態機與不可變稽核**

   - 以 Postgres 作所有權威狀態；瀏覽器只送操作意圖，不直接寫入金額、點數、有效分鐘、分數、出席摘要、資格或證明。
   - 主要領域：
     - 身分與權限：`people`、`auth_identities`、`staff_roles`、`role_approval_requests`、`organizations`、`organization_memberships`、`organization_invitations`。
     - 課程：`courses`、`course_versions`、`modules`、`lessons`、`video_assets`、`lesson_video_versions`、`instructors`、`course_requirements`、`hybrid_components`、`component_prerequisites`。
     - 積分：`accreditation_decision_revisions`、private identity profiles、verification cases、eligibility snapshots、submission batches、exports、certificates、certificate revisions。
     - 商務：`orders`、`order_items`、`bank_payment_instructions`、`payment_proofs`、不可變 `bank_transactions`、`bank_transaction_allocations`、`payment_events`、`invoice_records`、`invoice_events`、`refund_cases`、`refund_allocations`、`refund_disbursements`。
     - 學習：`enrollments`、`entitlements`、`playback_sessions`、`playback_events`、`presence_challenges`、`progress_summaries`。
     - 測驗與調查：`question_banks`、`question_versions`、`quiz_attempts`、`quiz_attempt_items`、`quiz_responses`、`survey_forms`、`survey_responses`、`survey_response_revisions`。
     - 直播：`live_sessions`、`live_breaks`、`live_session_assistants`、`live_bookings`、`zoom_meetings`、`zoom_participant_events`、`live_client_heartbeats`、`check_events`、`attendance_summaries`、`attendance_corrections`。
     - 企業點數：`point_topups`、`point_lots`、`point_ledger_events`、`course_point_prices`、`organization_assignments`、`assignment_point_allocations`。
     - 營運：legal documents／acceptances、notifications／outbox、support cases、security incidents、provider events、idempotency records、audit events。
   - 所有已發布的課程內容、價格、點數價格、題庫、完課分鐘、直播門檻、退款價格分攤及積分資料都採 immutable revision／snapshot。新內容建立新版本，既有訂單與修課永遠綁定原版本。
   - 核定決定與課程內容版本分離；核准、退件、展延、到期或撤銷只新增 `accreditation_decision_revision`，不修改既有課程版本。
   - 重要狀態：
     - 課程版本：`draft → in_review → published → suspended / archived`。
     - 積分核定：`draft → applying → approved / rejected → expired / revoked`；展延以新 revision 表示。
     - 訂單：`contract_review → pending_transfer → proof_submitted → payment_review → paid / rejected / cancelled / expired`；已入帳卻暫時無法履約使用 `paid_unfulfilled`。退款摘要由 refund 子紀錄推導 `refund_pending / partially_refunded / refunded`，不把多次退款塞進單一 order transition。
     - 發票／收據紀錄：主件 `pending → issued / failed`；多次部分折讓、作廢及更正使用 append-only invoice events／allowance 子紀錄推導目前狀態。
     - 積分身分資料：`draft → submitted → verified / needs_correction / rejected`。
     - 修課：`active → completed → submitted → credited / needs_correction / rejected / revoked`，退款另保留 `refunded` 終態。
     - 直播場次：`draft → scheduled → open → in_progress → ended / cancelled`，供應商異常可進 `reconciling`。
     - 機構：`submitted → approved / rejected / suspended`。
   - 付款通知、付款核銷、點數、觀看、挑戰、考試、Zoom、簽到退、資格、匯出、證明、高權限操作及人工更正均寫入 append-only event。更正只能新增反向／補正事件；不得改寫或刪除原始事件。
   - 低頻 provider webhook 在供應商提供 native event ID 時以該 ID 去重；未提供時使用該 adapter 已定義的 canonical event fingerprint。高頻 heartbeat 使用每個 session 的 monotonic sequence、資料庫 compare-and-set 與交易鎖，不建立單一全域高爭用去重表。
   - 高量 playback／live heartbeat events 依月份分割並保留 default partition；每門課的 retention policy 決定在線保存、加密封存與刪除時間。保存期內，具 checksum manifest／簽名 hash 的可重載冷封存仍是權威事件庫；drop hot partition 前必須從封存成功重算並核對 summary。法定保存期屆滿、無 legal hold 且事件正式刪除後，權威改為當時封存的 signed eligibility／certificate snapshot，不再宣稱可由已刪事件重算。

4. **手機 OTP 登入、帳號復原及完整權限系統**

   - 學員只有台灣手機簡訊六位數 OTP：
     - Supabase Phone Auth＋Twilio Verify。
     - OTP 有效 5 分鐘，60 秒後可重寄。
     - Turnstile 必須在 Supabase Auth 層強制驗證，不只放在 Next.js UI／route；啟用 Auth hook、phone／IP／device rate limit、錯誤次數限制、Twilio spend cap 與濫用告警。
     - 第一次驗證成功自動建立 `person` 與 auth identity。
   - 不提供 Email／密碼、Google、LINE、匿名或手機密碼登入。Email 只作通知與復原輔助。
   - 同一手機不可由兩人共用；機構管理員不得代員工建立共用帳號或代替學員上課。
   - OTP 證明目前控制該門號，不等於證明是舊帳號原持有人。具有付款、證明或敏感身分資料的既有帳號，在新裝置、長期未登入、風險訊號或 identity epoch 改變時先進 restricted mode：可收到 OTP 並提出驗證，但不能讀取舊購買、PII、證明或匯出，直到舊可信裝置／已驗證 Email 確認，或完成高保證人工重驗。
   - 更換手機：
     - 可使用舊手機：驗證舊號與新號後更換。
     - 舊手機遺失或疑似回收門號：申請人須提供與既有加密身分檔、訂單／匯款或正式證明相符的高保證證據；附件走隔離掃描。客服受理、兩位不同平台管理員審核、24 小時冷卻、通知舊手機與已驗證 Email、撤銷全部 sessions，才可綁定新號。未通過不得取得舊資料。
   - 平台角色：
     - learner
     - instructor
     - course_admin
     - accreditation_reviewer
     - finance
     - support
     - platform_admin
   - 機構角色：
     - owner
     - training_manager
     - finance
     - member
   - staff 可以兼任多角色，但每項權限以 active database assignment 判斷；JWT metadata 只作提示，不作唯一授權來源。
   - staff 登入仍用手機 OTP，進入後台須完成 TOTP AAL2。敏感操作不能只相信 JWT 曾達 AAL2；必須當下完成新的 TOTP challenge，server 保存 `verified_at`，再簽發 5 分鐘、綁 actor／action／target／nonce、一次性的 step-up grant。敏感 RPC 同時檢查 grant 與資料庫 identity／session epoch；角色變更、復原或全域登出提升 epoch，使尚未過期的舊 JWT 也失去敏感資料權限。
   - 必須雙人核准且 submitter 與 reviewer 不得相同：
     - 遺失手機／TOTP 復原。
     - platform admin 或其他高權限升降級。
     - 解密／匯出完整身分資料。
     - 人工出席、有效分鐘、完課或資格更正。
     - 正式證明撤銷。
     - 退款、發票作廢／折讓。
     - 已發布積分資料變更。
     - 法定保存資料的例外刪除。
   - 單一授權人員可執行一般課程草稿編輯及單筆人工銀行入帳確認，但本人不得審核自己的訂單或角色申請。
   - Bootstrap 前兩位 platform admin：兩人都先以一般手機 OTP 註冊並完成 TOTP；一次性、受保護、只在「目前零名 staff」時可執行的 server runbook 同時核對並建立兩位管理員，永久寫入 bootstrap completed marker 後停用。兩人分別保管離線 break-glass 材料；break-glass 必須兩人共同使用、立即告警、重設所有相關 session／TOTP 並全程 audit。後續高權限一律走雙人核准。

5. **個資加密、資料最小化與保存**

   - `person` 是訂單、學習、證明與 audit 的穩定擁有者；Supabase Auth user 只透過可停用的 identity link 連接，刪除／停用登入身份不得 cascade 刪除業務歷史。手機只保存在 Supabase Auth 必要位置，不在 public profile 再存一份明文。
   - 第一次報名積分課時建立可重用的積分身分檔案；每次報名再次確認。欄位包括真實姓名、身分證／居留證、出生日期、長照人員認證字號、人員類別、電話與服務單位。
   - 身分資料於付款後、開始正式學習前蒐集；積分尚在申請中的預售不提前收取不必要的完整證號。
   - 身分證／居留證、長照字號及必要敏感欄位使用 AES-256-GCM；每個 person 使用獨立 DEK，再由 versioned KEK 包裝；查重使用獨立 HMAC blind index。key 只在 server 端，支援雙 blind index 與可續跑的輪替／重包裝；不得把明文、key 或可逆資訊送到瀏覽器。
   - 建立 PII copy／key dependency map，涵蓋 database、PDF、Excel export、notification payload、provider、Storage、log 與離線備份。敏感 artifact 各自 envelope-encrypt；通知只放最少遮罩資料，不寄完整 PII 附件。KEK 由受稽核的 managed KMS／等價 secret manager 管理，另有離線、雙人共同復原的加密備份，不能只存在單一 Vercel project。
   - support、course_admin、機構管理員只看遮罩；accreditation reviewer 只有在核對案件中、填寫理由且通過 step-up／雙人核准後才能解密必要欄位。
   - 不預設收身分證照片。只有補正案件確有必要時才上傳到 private bucket；案件結束 30 天後刪除檔案，只保留加密欄位、審核結果與檔案 hash。
   - 禁止上傳可識別個案、病歷、診斷或服務使用者健康資料；課程問答與教材上傳介面明確提示，管理員可隱藏內容但原始稽核紀錄保留。
   - 每種資料依辦課單位、認可單位、稅務與法律確認的保存期設定 policy revision；未設定保存期的積分課不得發布。
   - 帳號刪除將非必要資料匿名化；仍在法定／積分保存期的付款、證明、送審與 audit 保留到期。可刪除資料透過 DEK crypto-shred 與不可回連的 pseudonym 處理；刪除 manifest 另存於不跟資料庫一起還原的私有控制面。任何 restore 都必須先 replay tombstones 才能重新開放服務。任何解密、匯出、下載與刪除都記錄 actor、理由、時間與目標。

6. **法律文件、契約成立、客服與退款規則**

   - 正式收費前由台灣律師／消保專業人員確認平台分類、定型化契約、七日解除權、比例退款與長照課程關係；未完成時 `b2c_commerce` 保持關閉。
   - B2C 網路教學採 72 小時契約審閱：
     - 首次提供可下載／列印的完整契約與版本 hash。
     - 72 小時後開放第二次確認。
     - 第二次確認完成後才可建立匯款訂單。
     - 保存兩次呈現／確認時間、文件版本、IP、device 與電子形式同意。
   - 第一版不主張全面排除七日解除權：
     - 尚未開始錄播、尚未舉行直播：全額退款。
     - 錄播已開始：已提供比例＝有效累積分鐘／版本要求分鐘，上限 100%，乘以錄播價格分攤。
     - 每個直播 component 在發布前具有清楚價格分攤；未舉行可退，已正常舉行視為該 component 已提供。
     - 混合課的錄播與每個直播 component 價格分攤在購買前顯示，總和必須等於總價。
     - 不收違約金，不扣贈品或積分申請價值。
     - 收齊正確退款帳戶資料後 15 日內完成退款，並連動人工發票／收據作廢或折讓。
   - 積分未核准、歲悅取消、無法補救的重大平台／Zoom／Stream 故障、核定內容重大改變或無合適補課場次時，受影響部分或整筆依契約全額退款，不使用一般比例公式。
   - B2B 真正供機構營業使用者使用獨立企業契約與點數退款條款；無法確定是否屬消費交易時，套用較有利消費者的 B2C 規則。
   - 平台流程支援：
     - 計畫維護原則上提前 7 日公告。
     - 契約重大變更提前 30 日通知並保存版本。
     - 已知教材明顯錯誤於 3 個工作日內更正或下架。
     - 客訴於 15 日內回覆處理結果。
     - 系統中斷補回期間／時數、安排補課；無法補救時依契約退款。
   - 網站正式揭露法人／營業人名稱、統編、地址、電話、Email、銀行帳戶、服務內容、含稅價格、設備需求、申訴與退款方法；缺任何必填營運資料時禁止開啟收費。

7. **建立通用課程後台與雙人發布**

   - course_admin 可建立錄播、同步直播與混合課，編輯講師、封面、介紹、學習目標、章節、單元、試看、講義、影片、價格、點數價格、題庫、觀看分鐘、測驗、調查、完課條件及退款價格分攤。
   - 錄播正式課名依核定要求包含「網路課程」；同步 component 包含「線上同步課程」。前台分類統一顯示「長照積分課程」，不以不同商品分類混淆使用者。
   - Cloudflare Stream：
     - 後台取得 one-time direct upload URL，瀏覽器直傳，server 不代理大檔。
     - 狀態 `uploading → processing → ready / failed → archived`。
     - signed webhook 驗證、時間戳與 idempotency。
     - 付費影片只允許短效 signed playback；已產生學習紀錄的 asset 只能封存或建立新版。
     - 正式影片原始 master 另存於歲悅控制的低成本私有備份位置，避免 Stream 帳戶事故造成唯一原檔遺失。
   - 每門積分課必須綁定依法可辦課的主辦單位或正式合作機構、認可單位、送審方式、核定／申請資料、有效期間、保存期與聯絡窗口。
   - `applying` 可附條件預售，但所有課程頁、契約、訂單及通知必須同等醒目顯示「積分申請中、尚未核定、不保證取得點數」；核准前不得提供正式內容、開始直播、核發積分證明或宣稱政府核定。
   - 若未於預定錄播開放日／直播開課日前核准，自動停止履約，建立全額退款案件；重大核定差異要求學員重新確認或選擇全額退款，取消訂單不得自動復活。
   - 每個 decision revision 保存 `effective_at`、`valid_from`、`valid_until`、是否及如何依正式文件溯及既往、來源文件與 review snapshot；平台管理員不能自行把 retroactivity 改成有利結果。
   - 發布時鎖定 `minimum_completion_window` 與 `commerce_close_at`：
     - 錄播最晚可售／可指派時間不得晚於核定到期日減去經審核的合理完成緩衝。
     - 所有直播／混合 live sessions 必須在核定有效區間內，且人工匯款關單日更早。
     - checkout／assignment RPC 自行檢查時間；Cron 只作提前停止與通知，不是唯一防線。
   - 核定狀態影響矩陣：
     - `applying`：可附條件收款，但 paid entitlement 維持 locked，不能學習／入場／發證。
     - `approved`：只有落在有效區間且已重新驗證版本／揭露一致的訂單才開通。
     - `rejected`：所有未履約 paid 訂單進全額退款；機構 reserved points 全數釋放。
     - `expired`：立即停止新銷售／指派；到期前已完成者仍可送審並保留 snapshot，到期後才完成者不得標示該期積分，依契約選有效新版、非積分完成或退款。
     - `revoked`：依正式撤銷文件的生效與溯及範圍停止 admission／發證；pending／active 進轉課或退款，completed／submitted／credited 建立影響清單，未有主管機關依據不得自行抹除歷史，正式撤證需雙人核准與新 revision。
   - accreditation_reviewer 與 course_admin 必須是不同人。發布檢查至少阻擋：
     - 主辦／認可資格不完整。
     - 核定狀態、申請中揭露或有效期間不完整。
     - 付費影片未 ready。
     - 題庫少於 20 題或抽題／分數設定不完整。
     - required watch minutes、直播門檻、休息時間、價格分攤、B2C 售價或 B2B 點數價格缺漏。
     - legal document revision、退款規則、銀行資訊、個資保存政策未核准。
     - Zoom host／容量／助理或 provider health 不符合該場次。
   - 已發布且有訂單、指派或學習紀錄的版本不得刪除，只能停止販售、封存或建立新版。

8. **B2C 人工銀行匯款、核銷、發票紀錄與退費**

   - 個人只可為自己單堂購買錄播、直播或混合課；不做購物車、贈課、訂閱、套裝或自動續扣。
   - 建單前 server 重新計算課程版本、總價、價格分攤、核定揭露與契約版本，產生不可變訂單編號與快照。
   - 一般錄播訂單匯款期限為 72 小時。
   - 含直播 component 的個人訂單：
     - 必須在首個直播場次至少 3 個工作日前建立。
     - 座位暫留 24 小時；期限內提交匯款資料後，暫留最長延長 2 個工作日供財務核對。
     - finance 目標於 1 個工作日內處理；逾期未提交或核對不通過即釋放座位。
     - 已確認實際入帳但場次已無法履約時進 `paid_unfulfilled`，只可由學員選擇合適場次或全額退款，不得強行開通其他內容。
   - 匯款提交欄位：訂單編號、匯款人、銀行、帳號末五碼、匯款時間、金額；可選 private proof。proof 保存 SHA-256／內容指紋並拒絕重複使用；proof 本身不開權限。
   - finance 只能從每日銀行明細來源檔／受控人工輸入建立不可變 `bank_transaction`；每筆保存原始來源 hash、附件 reference、批次、銀行流水 fingerprint、入帳日、匯款人／末五碼、總額與未分配餘額。另一位 finance／platform admin 每日對整批來源 hash 與銀行帳面完成 reconciliation。
   - 一般、非關係人的低額 B2C 訂單可由一位授權 finance 核銷；所有 organization top-up、歲悅員工／關係人訂單及達營運政策高額門檻的款項，必須在開權限／鑄造點數前由第二位不同人確認。高額門檻是需雙人核准的版本化平台設定；未設定時 `b2c_commerce` fail closed，而 organization top-up 無論金額都固定要求雙人確認。
   - allocation ledger 可把一筆或多筆銀行交易分配到一張或多張訂單。資料庫約束累計分配不得超過交易金額，也不得讓訂單已確認金額超過應付金額。
   - 少匯、多匯、拆單匯款、合併匯款、逾期入帳、無訂單入帳與 finance 輸入錯誤都進 reconciliation／remediation case；更正只新增反向 allocation event，不改舊交易。只有訂單累計合法入帳額精確符合應付金額，且期限／容量仍可履約時，才原子標記 paid 並建立 entitlement／booking。瀏覽器返回頁或 proof submission 永遠不能解鎖。
   - 付款與權限使用 idempotency key；重複按鈕、重複核銷、同時核銷與瀏覽器關閉都不會重複建立權限。
   - 電子發票尚不串 API。付款後建立人工開票待辦；finance 在既有外部發票／收據系統完成後，回填號碼、日期、買受人、統編、金額及狀態。開票失敗不撤銷已付款權限，但會告警並列入營運待辦。
   - 是否開統一發票、教育勞務稅別、開立時點與折讓方式由會計師／國稅局書面確認；人工匯款不等於免開發票。
   - 每個 refund allocation 明確綁定 order item／recorded allocation／live component 或 whole-order scope。案件一經受理，即在同一交易只凍結受影響 scope 的 access、lease、booking 與有效使用量 snapshot；學員不能在退款計算後繼續增加該 scope 已提供比例。案件駁回時才以明確恢復事件重新開放；核准則維持凍結。
   - 每次核准退款建立獨立 allocation、disbursement 與 invoice allowance／void event；支援 partial、重試、付款失敗及多次部分退款，累計退款不得超過訂單實收。比例退款的小數採對消費者有利的進位方式。實際匯回完成後只撤銷相同 scope 的未來 access／Stream／Zoom token／booking並重算資格；未退款且仍付款的錄播／直播 component 保持可用。只有 whole-order termination 才撤銷整門 entitlement；若被退款的是必修 component，整門正式 completion 轉為不可達／需轉課，但保留未退款內容。撤銷尚未正式 credited 的受影響證明、保留歷史 audit，並完成發票作廢／折讓待辦。已簽發短效 token 的最大殘留時間須在營運文件中明示。

9. **錄播有效分鐘與每 10 分鐘防掛**

   - 影片固定 1×；允許暫停、倒轉與續播。向前 seek 本身不計時；背景分頁、播放器暫停、buffering、離線、網路中斷或頁面關閉均不計時。
   - 同一帳號同時只有一個有效 recorded playback lease；新裝置接管時明確提示並使舊 session 停止計時。多分頁與重放 heartbeat 不會重複累計。
   - 前端每 15 秒回報 session nonce、monotonic sequence、媒體位置、播放狀態、visibility、網路狀態與 server challenge。server 依可信接收時間、相鄰事件上限及 lease 驗證建立 append-only有效區段；client 回報秒數只作證據，不作權威總數。
   - 每累積 10 分鐘「候選有效時間」即暫停影片，顯示大型確認視窗並播放提示音；學員有 90 秒按下「我還在上課」。
   - 前一個 10 分鐘區塊只有在正確確認後才轉為正式有效分鐘。逾時則：
     - 該 10 分鐘區塊不計入。
     - 停止繼續累計。
     - 播放位置回到該區塊開始處。
     - 不鎖帳號，學員可重新觀看。
   - 若 required watch minutes 不是 10 的整數倍，最後不足 10 分鐘的剩餘區塊在達到完課目標時同樣觸發一次確認；確認前不得用該剩餘區塊完成課程。
   - challenge 跨 lesson、reload、裝置接管與 session 保存；token 一次性、短效，確認與區塊入帳在同一資料庫交易，不能靠重送 heartbeat 代替。
   - **完課只看累積正式有效分鐘。重複觀看同一時段可再次認列，不要求內容覆蓋率，也不以影片長度封頂。**
   - required watch minutes 由每個核定課程版本設定並在發布後不可更改。summary 必須可由原始事件重算；若 summary 與重算結果不一致，以事件重算並建立營運異常。
   - Cloudflare signed playback token 短效；播放器另外顯示可見的 client-side 動態姓名／訂單 overlay。此 overlay 可被進階使用者移除，不是 Stream server-side forensic watermark；明確告知無法完全防止螢幕錄影。第一版不做 DRM、下載或離線播放。

10. **測驗、滿意度、完課與正式積分**

   - 每個正式 course version：
     - 題庫至少 20 題。
     - 每次 server 隨機抽 10 題並打亂選項。
     - 30 分鐘作答。
     - 80 分及格。
     - 不限補考次數。
     - 通過後結果鎖定；管理員不能修改分數，只能以理由作廢 attempt。
   - 瀏覽器不收到正解；server 評分並保存題目／選項版本 snapshot。未通過只顯示分數與需加強主題；通過後可顯示學習解析，但不直接提供可複製的完整答案表。
   - 滿意度固定 5 個 Likert 題：內容、講師、平台、實用性、整體；另有選填文字。一份修課可在送出後 24 小時內修改一次，之後鎖定並保存 revision。
   - instructor／course_admin 只看匿名聚合；機構不能看個人答案或文字；platform staff 只有在有理由的調查案件中可查看原始內容並留下 audit。
   - 正式積分資格：
     - 有效已付款 entitlement 或有效機構指派。
     - 積分身分資料 `verified`。
     - 錄播達 required valid minutes；直播／混合達各 component 出席門檻。
     - 至少一次測驗達 80。
     - 滿意度已完成。
     - 所適用 accreditation decision 在權威日期有效。
   - 最終資格計算、修課狀態 transition、certificate revision 與通知 outbox 必須在鎖定同一 enrollment 的交易／RPC 中完成，重新檢查 entitlement 與 refund 狀態；同一修課只能有一個 active certificate revision。
   - 錄播資格日期以 `completed_at` 為準；直播以正式 `session_starts_at` 為準；混合必須讓每個 component 都落在其核定有效範圍，最後依核定規則合併。不得以購買日自動保證積分。
   - 完課與官方 credited 分開：
     - `completed`：已達平台課程條件，可發歲悅完課證明，顯示積分登錄待處理。
     - `submitted`：已匯出／送審。
     - `credited`：認可單位確認登錄後，才可標示正式積分完成。
     - `needs_correction / rejected / revoked`：公開驗證頁顯示相應狀態，不刪除歷史。
   - PDF certificate 保存姓名、課名、版本、日期、核定字號、積分、核定單位、場次／出席門檻與文件 SHA-256 snapshot。QR 使用至少 128-bit CSPRNG verification token，資料庫只存 hash；公開頁採 constant-shape not-found response、嚴格 IP／token rate limit、`noindex`／`noarchive`，不可用流水號搜尋或列舉。頁面只顯示遮罩姓名、課程、日期、積分與目前狀態，不公開證號或完整身分資料。
   - 送審匯出以指定 course version／accreditation revision／live session 為範圍，提供資格預覽、缺件原因及模板版本。完整身分匯出須雙人核准，透過 authenticated application endpoint 原子消耗一次性 capability 後串流 private object；不得直接暴露可重複使用的 Storage signed URL。保存匯出人、時間、篩選、學員數、模板版本與 SHA-256；Excel 防公式注入。

11. **Zoom Meeting SDK 同步直播與 200 人容量**

   - 直播使用歲悅 Zoom 帳戶的 Server-to-Server OAuth、Meeting SDK app 與 verified webhook；學員只登入歲悅，不需 Zoom 帳號。
   - server 以 `liveSessionId` 驗證付款／指派、booking、入場時間與帳號後，簽發 participant SDK signature、lease 專屬 registrant token 及單一 active join lease。Zoom Web SDK join 需要 meeting passcode；passcode 只在 authenticated join response 中短暫進入 browser memory，不顯示於 UI、不寫 log／URL／analytics／local storage，並以 CSP、waiting room、registration 與 server 授權降低暴露。SDK secret與 OAuth token 永不送 client。
   - Zoom registrant API 需要 Email，但 learner Email 仍維持選填。每個 lease 使用 `zoom-id.suiyuecare.com` 受控網域下的 128-bit random synthetic Email，不包含 person／phone／order 可推回資訊；關閉 Zoom 寄信與 catch-all mailbox，只用於 provider schema。
   - 指定 instructor／platform admin 使用隔離主持人 console；只 allowlist 固定版本的 Zoom Meeting SDK artifacts 與官方必要 Zoom origins，禁止 analytics 及其他不相關第三方 scripts。server 在 fresh-TOTP step-up 後取得短效 role-1 signature 與 ZAK，並檢查主／備主持人、waiting room、音訊／鏡頭及 meeting state。Meeting SDK host join 必須把 ZAK 短暫送到 host browser memory，因此使用嚴格 CSP／Trusted Types、不依賴 browser extension、不持久化，join 完成後立即清除；ZAK 不寫 log、URL 或 browser storage。
   - desktop 支援 Component View；iPhone／Android 或不相容環境使用 Client View。上線前實機驗證兩種加入模式、音訊、鏡頭、重連與 heartbeat。
   - 每筆 booking 建立隨機 `customerKey`，Zoom participant webhook 以此對應歲悅學員，不使用姓名或 Email 當唯一身分。
   - webhook 實作 CRC、`x-zm-signature`、timestamp 防重放與 event idempotency，處理 meeting started／ended、participant joined／left。Zoom 未保證通用 event ID／monotonic sequence，因此 dedup key 使用 event type、account、meeting UUID、participant UUID／customerKey、occurrence timestamp 與 canonical payload hash；另產生內部 ingest sequence，只代表到達順序，不冒充 provider 發生順序。
   - 學員人數最多 200，但 Zoom license capacity 是會議內所有人總數。可售學員容量為 `min(課程學員上限, 已驗證 Zoom 總容量 − host − co-host − assistants − reserved support, 助理法規允許容量)`，不得把工作人員當成額外免費名額。
   - 助理法規允許容量：
     - 1–50 人：助理不作法規硬性要求。
     - 51–100 人：至少 1 名課程助理。
     - 101–150 人：至少 2 名。
     - 151–200 人：至少 3 名。
   - 場次可先建立到 200，但未配置足夠助理或 Zoom 總容量不足時自動限制新增名額，不封鎖既有較小規模場次。若要售滿 200 名學員，Zoom 授權必須額外容納 host、助理與支援席位。
   - 不得直接移除助理而使已確認名額超出合規容量；必須先補上替代助理，否則建立營運事故並停止新增 booking。
   - 上課入場前再次確認實際到場助理。助理不足且會使場次超過允許人數時，不得任意擋掉部分已付款學員；先啟用備援助理，仍不足則延後／取消並啟動全員通知、免費改場或退款／點數返還。
   - `zoom_host_resources` 保存主／備主持人、license、concurrency slots 與驗證時間。建立或改期先在短交易中寫入具期限的 pending host reservation，提交後才呼叫 Zoom，再以 compare-and-set 完成 saga；網路呼叫期間不持有 DB lock。失敗進 `reconciling` 並停止新 booking，不先釋放仍可用的舊 reservation。
   - 預設加入靜音、學員不可分享畫面或改名、關閉雲端錄影、課前 10 分鐘顯示等待畫面。直播不錄影、不回放。
   - 簽到窗口：課前 30 分鐘至開課後 15 分鐘。
   - 簽退窗口：結束前 15 分鐘至結束後 30 分鐘。
   - 簽到前完成 camera／microphone／speaker 測試；設備失敗可提出人工異常案件，但不自動判定合格。
   - client 每 15 秒回報本人 camera state；heartbeat gap 超過 45 秒停止累計。正式 numerator 逐區段只取 `Zoom presence ∩ fresh heartbeat ∩ locked scheduled teaching window − locked breaks`；課前／課後簽到退窗口只接受事件，不增加正式秒數。重連區段合併且不得重複。
   - attendance denominator 固定為發布／核定的 scheduled teaching seconds 減去發布時鎖定的正式 breaks；遲開、早退或臨時增加休息不會自動縮小分母。實際 start／end／break 只能新增不可變 evidence event，不能回寫 schedule snapshot。
   - 預設有效在線與 camera seconds 均須達 denominator 的 80%；每門課可依核定要求在發布前設定更高門檻，發布後不可修改。中央規範沒有被誤宣稱為全國固定 80% 鏡頭規定。
   - provider events 依 meeting UUID 與 occurrence timestamp 接受亂序資料；內部 ingest sequence 不用來推定實際先後。場次結束後保留固定 24 小時 evidence settlement window 才自動結算。更晚事件建立 anomaly，不直接改合格結果，後續只能走雙人 correction。
   - 直播不使用錄播的每 10 分鐘防掛；簽到退、Zoom presence、client heartbeat、camera evidence與多元評量共同作出席證據。
   - 客服只能看狀態；人工補正須由管理員提出、第二人審核、填理由並新增 correction event，不改原始 Zoom／heartbeat。
   - 每次 join lease 建立獨立 Zoom registrant；接管時先使舊 lease epoch 失效、撤銷／刪除舊 registrant、停用 removed participant rejoin，並透過 Zoom participant control API 移除舊 participant。Meeting SDK JWT 在到期前無法由本地 DB 撤銷；若 Zoom 無法證明舊 registrant／participant 已失效，新 lease 在舊 credential 到期前 fail closed。發生 duplicate anomaly 時兩段時間均暫不計入，等待 reconciliation。
   - 歲悅取消場次時免費改場；無可接受場次則全額退款／返還機構點數。學員 no-show 不刪除錄播進度，直播 component 保持未完成；補課或額外費用必須是發布前明示且經律師核准的 course policy。

12. **混合型課程要求圖與跨 component 履約**

   - 混合課不是錄播與直播的簡單標籤，而是 immutable requirement graph：
     - 多個必修 recorded components。
     - 一個或多個必修 live components。
     - 每個 live component 可提供多個等價 session。
     - 可設定 prerequisites 與順序。
   - 發布時只允許同一 course version 內的有向無環圖；檢查 cycle、跨版本 edge、孤兒必修節點、無起點／終點及不存在可完成路徑，任一不通過即阻擋發布。
   - B2C 在建單時選擇各 live component 場次並取得暫留；B2B member 在機構 assignment 後選擇場次，選場時才占 Zoom 容量。
   - 所有 recorded minutes、所有 required live components、測驗、滿意度及身分核對均通過，才完成一門混合課並產生一張證明。
   - 場次取消只替換該 live component，不清除錄播進度、測驗 attempt 或其他已完成 component。
   - 學員可在場次前 24 小時自行換到有空位的等價場次；換場在固定 lock order 的單一交易先鎖定新場最後一席，再撤銷舊 booking，任何失敗都保留舊位。24 小時內只能提出例外案件。核准的設備故障／疾病可免費轉一次並留下 audit。
   - 若核定到期前沒有可完成的替代場次，B2C 付款人選擇全額退款或有效新版；B2B 由 organization owner／training_manager 決定轉課或返還點數，member 不能處分機構資金。

13. **B2B 機構申請、手機邀請與點數錢包**

   - 機構管理者以相同手機 OTP 登入，提交機構名稱、統編、聯絡人、電話、發票 Email。統編唯一；既有統編改走加入／客服確認，不建立重複機構。
   - 首次申請由 platform admin 審核。owner 可修改機構資料及管理 training_manager／finance；training_manager 管理邀請、指派與報表；finance 處理購點與發票；member 只看自己的課程。
   - 邀請使用手機號碼：
     - 單筆或 Excel 批次。
     - Excel：手機必填，姓名、員工編號、部門選填。
     - 先錯誤預覽，全部通過才匯入；處理重複號碼與公式注入。
     - 邀請 token 一次性、hash 保存、7 天到期，可撤銷或重寄。
     - 既有歲悅帳號驗證同一手機後接受，不建立企業專用密碼。
     - 尚未註冊者的邀請電話以 E.164 正規化後加密保存，另用 invitation 專用 HMAC blind index 配對；不得存 public 明文。接受、撤銷或到期後依 retention job 清除可逆電話，只保留不可回連的結果與 audit。
   - 機構以人工匯款購買點數：
     - `1 point = NT$1`。
     - 整數點數，無贈送、無級距 bonus、不可跨機構轉移、不可兌現。
     - 未使用點數不過期。
     - 僅未使用點數可依原實付價申請退款；退款後 append-only 扣除對應 lot，不得產生負餘額。
   - top-up 建單、proof、finance 核銷與人工發票紀錄沿用 B2C 安全規則；付款確認與 point lot 建立在同一資料庫交易並具 idempotency。
   - 每個 published course version 有整數 organization point price snapshot。
   - 指派時交易鎖定 wallet，依 oldest available lot 分配並建立 reserved ledger event：
     - 錄播：第一次通過 server 驗證、可進入候選有效分鐘的播放區段時，整筆 course points 轉為 consumed；該區段是否最後通過 10 分鐘 challenge 是另一件事。
     - 直播：場次進入不可自行改場的前 24 小時時轉為 consumed；若此前已正式簽到則立即 consumed。
     - 混合：第一次有效錄播或最早 live cutoff／簽到發生時，以較早者將整門課點數 consumed。
   - consumed 前，training_manager 可收回 assignment 並完整釋放 reserved points；consumed 後不得換人或一般退款。歲悅取消、核定失敗或依法退款以補償 ledger event 返還等值點數或退還原付款人。
   - 同一 member 已擁有相同 course version 或相同 live session 時，不得重複消耗點數。個人自購權限與機構指派分開顯示，不能讓機構看到個人購買或其他機構紀錄。
   - 機構只能查看自己資助的員工：指派、正式有效分鐘、直播出席比例、完成狀態、測驗分數／通過、證明狀態及點數 ledger；不得看完整證號、題目答案、個人調查文字、原始防掛事件或其他機構資料。
   - 員工離職後，機構可在必要保存期間查看該機構出資的既有培訓結果，不得查看後續個人活動。
   - 報表依 course／version／session／部門／狀態篩選；Excel 包含培訓摘要、員工成果、直播出席、點數異動，使用原生日期／百分比、凍結標題及狀態圖例，不含敏感明文、測驗作答或原始個資事件。

14. **通知中心、Resend、SMS、行事曆與營運工作佇列**

   - 網站通知中心是權威通知紀錄，保存 unread／read 時間；Email／SMS 是外部投遞管道，投遞失敗不改變付款、資格或出席狀態。
   - Resend＋React Email：
     - 驗證 `mail.suiyuecare.com` 的 SPF／DKIM。
     - 寄送訂單、匯款核對、機構邀請／指派、行事曆、直播提醒、發票資訊、退款、補正、完課與證明。
     - provider webhook 保存 accepted／delivered／bounced／complained／suppressed。
     - 使用 durable outbox 與 business idempotency key，重試不重複寄送。
   - 聯絡 Email 驗證碼使用 server secret HMAC，10 分鐘有效、最多 5 次錯誤、同一 person＋Email 只保留一個 active challenge，新碼取代舊碼；成功時原子 consume，並依 person／Email／IP rate limit。
   - SMS：
     - OTP。
     - 付款核對結果。
     - 直播前 24 小時與 1 小時。
     - 緊急取消／改期。
     - 重要個資補正與帳號復原。
   - learner phone 必填、Email 選填；沒有 Email 時仍可從網站下載訂單、行事曆與證明。organization owner／finance 及 staff 的 Email 必填並驗證。
   - `.ics` 包含課名、場次、入場連結、時區與更新 sequence；改期／取消產生正確更新。
   - 背景工作全部使用 Postgres durable jobs／outbox；Vercel Cron 只負責安全喚醒 worker。worker 驗證 `CRON_SECRET`、以 lease 防重入、可重試、dead-letter、保存 last success／oldest job age。
   - 另用不依賴同一 Supabase／Vercel 登入面的外部 synthetic monitor 與獨立告警接收器，檢查公開站、Auth、健康端點與 dead-man signal；整個主系統不可用時仍能通知事故負責人。
   - 後台提供供應商狀態、付款待核、發票待辦、補正、退款、證明、通知 dead-letter、Zoom capacity conflict、Stream processing failure 與 audit 查詢。

15. **資安、RLS、API 邊界與最低事故處理**

   - 所有 public tables 明確 `REVOKE`／`GRANT` 與 RLS；private schema 不透過 Data API 暴露。新 table 未啟用 RLS 或未列權限矩陣時 migration／CI 失敗。
   - anon 只能讀取去敏感的 published catalog projection 與 masked certificate verification projection；view 使用 invoker 權限。authenticated 預設只讀自己的資料；所有 organization policy 必須同時驗證 active membership 與 organization ID。
   - 所有 learner-sensitive RLS、RPC、Storage download、Stream／Zoom token、PDF／export 與 certificate endpoint 都查詢 database-authoritative active identity link、`restricted=false` 及相符 identity／session epoch；不能只比較 `auth.uid()`。可含 PII／付款／舊權限的表撤銷 browser 直接 SELECT，改由窄化的 server endpoint／projection 提供。
   - `SECURITY DEFINER` function 固定 `search_path`、撤銷 `PUBLIC EXECUTE`、驗證 actor／role／organization／target；service role 只在 server route／worker 使用。
   - append-only audit／money／attendance owners 與 application writer 分離；application／service role 撤銷直接 UPDATE／DELETE，只能呼叫窄化的 append function。權威狀態變更若 audit insert 失敗則整筆交易 rollback。定期產生簽名 hash checkpoint 並匯出到獨立私有儲存，封存到期後仍可驗證完整性。
   - 每個 mutation route 使用 Zod／等價 schema validation、CSRF／origin 防護、idempotency key、rate limit 與 structured audit；redirect 使用 allowlist。錯誤訊息不洩露是否存在其他帳號、訂單或證號。
   - Stream、Zoom、Resend webhook 驗證簽章、timestamp、environment，以及 provider-native event ID 或 adapter-defined canonical fingerprint；未知／過期／重放事件安全拒絕。Bank transfer 沒有 webhook，finance action 必須在資料庫交易內重讀狀態。
   - payment proof、身分補件、課程附件與企業 Excel 先上傳到不可由一般使用者讀取的 quarantine bucket；限制檔案大小、允許清單、MIME＋magic bytes、圖片像素、壓縮展開比與工作表／列數。隔離 worker 執行 malware scan、必要的影像重編碼／metadata 清除與 Office／PDF 安全檢查，通過後才原子 promote；未通過則隔離並告警。未受信任檔案下載固定 attachment＋`nosniff`，不得 inline 執行。
   - 每個 person 一個 recorded playback lease、每個 live booking 一個 join lease；seat uniqueness 的作用域是 `payer/member + course_version + live_component` 最多一個等價 session reservation。混合課可同時為不同 required live components 各保留一席。交易使用固定 lock order，針對最後一席、同一 wallet、重複核銷、退款與完成判定做 concurrency test。
   - 最低成本資安事故流程：
     - 指定一位歲悅事故負責人。
     - 管理員可一鍵暫停敏感匯出、付款核銷與發證。
     - 發現疑似事故時保存 log／audit、撤銷受影響 sessions、輪替必要 secrets 並寄出管理員警報。
     - 提供一頁式處理清單，聯絡律師判斷個資通知或主管機關通報義務；若依法適用，支援 72 小時時限。
   - 不建立複雜 SOC 或定期演練系統；但未指定負責人、未測試 kill switch 或 audit 無法保存時不得正式收費。

16. **四視角 UX 與完整驗收**

   - 低科技能力 B2C 學員：
     - 手機首頁只呈現「找課程、我的課程、登入／通知」等核心入口。
     - OTP、契約審閱、匯款、填積分資料、開始上課、防掛、測驗、調查、補正與下載證明均以單一步驟畫面、白話狀態與可返回流程完成。
     - 匯款頁可複製帳號／金額／訂單編號；清楚說明「提交資料不等於付款完成」。
     - 網路中斷、OTP 未收到、影片尚未 ready、Zoom 權限被拒與漏簽退都有具體下一步，不顯示技術錯誤碼。
   - B2B 機構：
     - 申請、審核、購點、人工匯款、手機／Excel 邀請、指派、選直播場次、收回、查看點數、員工進度與匯出報表可由 owner／training_manager／finance 自助完成。
     - 權限與跨機構資料隔離用真實 multi-tenant 測試，不只檢查 UI 隱藏。
   - 後台管理員：
     - 從建課、上傳 Stream、處理失敗、建題庫、設定 hybrid graph、建立 200 人內場次、配置助理、積分送審、雙人發布、付款核銷、補正、匯出、發證、退款到事故暫停均有明確工作佇列與原因。
   - 工程師：
     - README 提供 local setup、mock provider、environment matrix、migration、seed、test、feature switches、provider webhook replay、incident runbook、deploy／rollback 與 restore 手冊。
     - CI 執行 format／lint、TypeScript、unit、integration、migration reset、RLS／GRANT、concurrency、production build、dependency／secret scan。
   - 自動化測試至少覆蓋：
     - OTP 過期、重寄、rate limit、直接呼叫 Supabase Auth endpoint 的 Turnstile 繞過、Twilio spend cap、回收門號 restricted mode／復原、staff fresh-TOTP step-up、session epoch 與雙人核准。
     - restricted identity 直接呼叫 PostgREST、RPC、Storage、certificate、Stream／Zoom endpoint 均 fail closed；maintenance write fence 後 Auth／Cron／webhook 無法新增資料。
     - 未付款不可播放／加入；proof 重送、少匯／多匯／拆單／合併／無訂單／逾期入帳、allocation reversal 與 finance 同時核銷不重複開權限。
     - 退款受理即凍結、駁回恢復、partial／多次／disbursement failure、累計上限及多次 invoice allowance。
     - component-scoped refund 只凍結／撤銷相同 scope，保留其他已付款 component；whole-order 才撤銷整門 entitlement。
     - 10 分鐘 challenge 的 79／80／90 秒邊界、跨單元、reload、重看、背景、斷線、雙裝置與 clock tampering。
     - 79 分／80 分、30 分鐘 timeout、無限補考、題庫版本與 client 無正解。
     - 直播 50／51／100／101／150／151／200 人助理門檻、最後一席、改期、host collision、重連、camera 79.9%／80%、正式休息、漏簽退與 webhook 延遲。
     - 混合 requirement graph、取消單一 component、換場、核定到期與 progress preservation。
     - 機構 wallet 同時指派、餘額不足、release／consume、退款、跨機構 RLS、重複 member 與個人權限衝突。
     - 加密資料不出現在 browser response／log／客服／機構報表；完整匯出需要雙人核准且下載過期。
     - 消費契約 72 小時、第二確認、七日／比例退款、全額例外、人工發票待辦。
     - provider outage、dead-letter、kill switches、paid-without-entitlement、entitlement-without-payment、summary drift。
     - quarantine 的偽 MIME、超大檔、zip bomb、惡意 PDF／Office、metadata 清除、掃描失敗與安全下載。
     - Zoom 總容量扣除工作人員、助理臨時缺席、24 小時 evidence settlement、亂序／遲到 webhook、不可變 denominator 與 duplicate participant eviction。
     - Zoom passcode 不出現在 URL／log／analytics／persistent storage、registrant 撤銷失敗時新 lease fail closed、課前課後與 break 不增加 numerator。
     - synthetic registrant Email 不可回推本人且不觸發 Zoom mail；host console 未 fresh-TOTP、載入未 allowlist 的第三方 script／Zoom origin、弱 CSP 或 ZAK 持久化時 fail closed。
     - Hybrid 每個 live component 可各有一席但同 component 不重複；換場競態保留舊位或完整取得新位。
     - QR token 不可枚舉、constant-shape response、rate limit／noindex；冷封存重載重算與 retention 到期後 signed snapshot 權威切換。
     - 每日 Storage manifest／checksum 還原、tombstone replay、KEK 雙人復原、audit hash checkpoint 與主系統完全不可用時的獨立告警。
     - 高額門檻未設定時 B2C commerce 關閉；organization top-up、關係人與高額款在第二人確認前不開權限／不鑄點。
   - 實機驗收：
     - iPhone Safari、Android Chrome、desktop Chrome／Edge。
     - SMS 在台灣主要電信門號的收碼率。
     - Cloudflare 真實 6 分鐘測試影片與長片。
     - Zoom desktop Component View、mobile Client View、弱網／斷線／TURN。
     - 受控 200 人 capacity rehearsal 或 Zoom 授權等級相符的負載驗證；未通過前系統將 production 可售容量限制在已驗證數量。
   - 人工 UAT 最少包含 10 位目標 B2C 學員（至少 5 位自認不熟悉手機）及 2 家機構、每家至少 5 位員工；核心流程不得由工作人員代操作。管理／財務／客服／審核流程由各角色真人帳號操作，不能以工程師直接改資料庫代替。

17. **部署、正式上線與上線後營運**

   - Git 目標改為 `Suiyuecare/Online-course.git`；在 `codex/` branch 完成乾淨重建，PR 內呈現 schema、權限矩陣、測試證據、provider checklist 與畫面驗收。不得把目前舊 repository 當 production source。
   - Vercel project `prj_0iqhcKOYkHIZYI2vrCcHq0hC8TvL` 連到新 GitHub repo；Preview 使用 test environment。通過所有 gate 後合併 `main` 並部署 `class.suiyuecare.com`。
   - 正式開關全數預設關閉。以下全部完成後，才同時開啟 B2C、B2B、錄播、直播與混合課：
     - Supabase reset／baseline／RLS／Security Advisor／restore proof。
     - 首位及第二位後台人員建立，TOTP／雙人核准實測。
     - Twilio Verify／SMS、Resend domain、Cloudflare Stream、Zoom apps／hosts／webhooks 正式設定。
     - 歲悅具合格辦課資格或已簽約的合格合作主辦單位。
     - 第一門各課型具有核定或合法且醒目揭露的申請中狀態；實際開課前必須 approved。
     - 律師核准 B2C／B2B 條款、72 小時流程、退款公式、個資告知及 pending presale。
     - 會計師／國稅局確認稅籍、發票／收據、開立時點、折讓及統編欄位。
     - 正式銀行帳戶、人工核銷 SOP、退款人員與處理 SLA。
     - 四角色 UAT、手機實機、200 人容量／助理規則、provider outage 與 incident kill switch。
   - 上線後：
     - 使用 Supabase Pro 內含 daily backup／7 日保存，不購買 PITR。
     - 每週加密 DB export；Storage objects 每日做版本化增量備份並產生 checksum manifest 到低成本 private storage，確保付款證明、補件與 PDF 的 RPO 同樣接近 24 小時。
     - Cloudflare 影片 master 另行備份。
     - 每次正式 migration 前增加額外 export。
     - 每半年執行一次 restore test。
   - 使用者已接受沒有 PITR 時最差可能遺失接近 24 小時資料；恢復目標暫定 8 小時，若半年 restore test 無法達成就更新 runbook 與對外營運承諾。人工銀行帳、Zoom、Cloudflare 與 audit 外部紀錄須可協助人工重建。
   - 營運 dashboard 與告警至少涵蓋 OTP 成功率／延遲、待核匯款、paid-without-entitlement、點數負值／ledger drift、playback heartbeat／重算 drift、防掛逾時、Zoom webhook freshness／capacity conflict、證明／通知 backlog、Cron freshness、5xx 與備份狀態。跨租戶存取、負點數、錯誤開通、有效分鐘正向多算或錯誤發證容忍值為零並立即告警；每個告警有 owner、嚴重度與 runbook。

## Key decisions & tradeoffs

- **乾淨重建且不備份舊應用資料。** 換取單一、乾淨的領域模型；代價是遠端清除不可逆，因此執行前非零資料安全斷言是硬門檻。
- **手機 OTP only。** 不做密碼、Google 或 LINE；降低低科技學員登入複雜度，但依賴 SMS 供應商與台灣門號收碼品質。
- **人工銀行匯款。** 暫不串綠界或其他支付；降低串接成本，但付款不是即時、直播需要保守的關單與座位暫留、財務人力成為營運關鍵。
- **人工發票／收據紀錄。** 網站保存工作流但不自動開票；換取較快上線，代價是人工 SLA、對帳與錯誤風險。
- **B2C 單堂購買；B2B 1 元 1 點錢包。** 點數不過期、無 bonus、不可轉移，簡化會計與學員分派；不做舊式每課席次包。
- **錄播只看總有效分鐘，重播可重複認列。** 不要求 unique coverage；每 10 分鐘成功確認後才入帳，逾時失去該區塊並重看。此規則必須由認可單位書面接受後才用於正式積分課。
- **Zoom Meeting SDK。** 學員不需 Zoom 帳號；代價是歲悅仍依賴 Zoom 授權、SDK、webhook 與行動裝置相容性。
- **直播最多 200 人。** 名額會依助理數與實際 Zoom license 動態下降；未配置足夠人員不能開放相應區段名額。
- **直接支援錄播、直播、混合三課型。** 共用版本、資格與商務核心；代價是第一版範圍大，必須在所有 gate 通過後一次上線，不以半成品真實收費。
- **積分申請中可附條件預售。** 增加招生彈性，但必須醒目揭露、核准前不提供內容，期限未核准即全額退款。
- **完課與正式 credited 分離。** 防止平台把「已上完」誤稱為主管機關已登錄積分。
- **B2C 保留解除／終止權並採比例退款。** 不嘗試用「數位內容」一概排除七日權；增加退款營運工作，但降低消保風險。
- **網站通知中心為權威，Resend／SMS 為投遞管道。** 外部訊息失敗不會竄改商務狀態。
- **最低資安事故流程，而非完整 SOC。** 保留必要 kill switches、負責人與法定通報能力，以控制成本。
- **不上 PITR。** 採 daily backup＋weekly export；接受最差近 24 小時資料損失，以換取最低備份成本。
- **不把「完全防錄影／完全防掛」當成產品承諾。** 平台保存可稽核證據並抑制一般濫用，但 browser／camera 狀態不能證明本人持續專注。

## Risks / open questions

以下不是待使用者選擇的產品分支，而是正式收費前必須由外部單位或真實環境驗證的 launch blockers：

- 歲悅本身是否符合長照繼續教育辦理機構資格；若否，必須完成合格主辦／送審合作契約。
- 認可單位是否接受「重複觀看同一片段可重複認列、以總有效分鐘為準」及每門課的直播出席／鏡頭門檻。
- 台灣律師須確認網路教學、長照核准課程、短期補習班與 B2B 的適用分類，以及 72 小時審閱、七日權、比例退款、pending presale 和 no-show 條款。
- 會計師／國稅局須確認營業登記、教育勞務稅別、統一發票／普通收據資格、人工匯款開立時點及退款折讓。
- 尚未取得或驗證 Twilio、Cloudflare Stream、Zoom 與 Resend production credentials、webhook secrets、寄件 DNS、Zoom host licenses 及 200 人實測結果。
- 尚未提供正式法人／統編／地址／客服／銀行／退款帳戶等營運資料；系統可建欄位，但缺值時必須 fail closed。
- 手機 OTP 會受 SMS 延遲、SIM swap 與回收門號影響；帳號復原 SOP 與兩位管理人員必須在上線前到位。
- 人工匯款、人工發票與人工退款若沒有每日人力，會直接造成直播座位、發票與消保 SLA 風險。
- 200 人場次的 camera telemetry 只能證明 client 回報與 Zoom presence，不能證明臉部或注意力；不得作超出證據能力的宣稱。
- 外部 provider outage 無法由程式消除；正式條款、補課、退款、通知與健康監控必須一起啟用。

## Out of scope

- LINE Login、LINE Messaging、Google OAuth、Email／密碼登入與匿名登入。
- 綠界金流、信用卡、ATM 虛擬帳號、自動銀行對帳、電子發票 API、自動退款與自動折讓。
- 訂閱、月繳、自動續扣、優惠券、課程包、贈課、B2C 點數、跨機構點數移轉或點數 bonus。
- 企業 SSO、HR 系統、月結請款、客製報價、組織樹、多層主管審批及外部 LMS 串接。
- Google Meet、自架 LiveKit／Jitsi、Zoom 錄影、直播回放、RTMS、人臉辨識、視線追蹤或影像內容分析。
- 影片下載、離線播放、DRM 或承諾完全阻止螢幕錄影。
- 公開評論、星等、收藏、追蹤、社群牆、公開學員名單及行銷簡訊／Email。
- 真實個案病歷或健康資料上傳。
- 紙本發票郵寄。
- 第一版的獨立無障礙認證或 WCAG 驗證專案；仍維持簡單、手機可操作與一般語意正確，但不把額外認證列為上線 gate。
