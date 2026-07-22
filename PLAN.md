# Plan: 歲悅學苑三線正式收費平台
_Locked via grill — by Codex + 歲悅團隊_

## Goal

在既有 Next.js、Supabase、Cloudflare Stream、綠界與 Zoom 程式基礎上，完成可同日正式收費上線的三條業務線：B2C 錄播長照積分課程、B2B 機構點數培訓、免 Zoom 帳號的同步直播課。平台必須以伺服器可稽核的方式計算有效觀看分鐘、固定每 10 分鐘防掛機、執行 80 分考試、保存積分資料與送審狀態、產生 PDF 完課證明，並同時具備真實金流、電子發票、角色權限、個資保護、異常處理、封閉測試與正式營運能力。

## Approach

1. **先固定現況、建立安全遷移基線**

   - 保留目前工作區所有既有修改，不 reset、覆寫或刪除使用者變更；先記錄 `git status`、目前 migration 檔案、遠端 migration history、資料筆數與 Storage 物件。
   - 在測試 Supabase 專案執行現有 test、lint、production build、migration lint 與 RLS 測試，產生「修改前」基線。正式資料庫只接受向前 migration，不重寫已套用 migration。
   - 先用遠端 `supabase_migrations`、schema dump 與本機 Git 歷史逐筆確認 migration timestamp／checksum。凡遠端已套用的舊 timestamp，從 Git 還原原檔並永久保留；同內容或變更內容卻換 timestamp 的鏈先隔離，不得 push。另建一支新的 reconciliation migration，明確處理「全新資料庫」與「已部署舊鏈資料庫」兩條可測分支，兩者最後都必須得到相同 schema fingerprint。
   - 目前程式與新規格的主要差異必須列入遷移：Email／密碼改為手機 OTP＋LINE；15 分鐘在席改為固定 10 分鐘；企業名額批次改為點數錢包；90%／單元時長上限改為可重複累計有效分鐘；核定後才能發布改為申請中可販售但強制揭露；QR 網頁證明改為 PDF-only；滿意度不再阻擋發證。
   - 若遠端已有真實使用者、訂單或學習資料，先做可還原備份與資料轉換演練；只有確認測試專案及備份可還原後，才允許套用正式 migration。
   - 測試與正式環境完全分離：Supabase、Vercel、綠界、電子發票、LINE、Twilio、Cloudflare、Zoom、寄信、Cron 與收件人都使用不同憑證或明確的環境隔離。

2. **用向前 migration 建立新的領域模型與狀態機**

   - 保留既有訂單、enrollment、影片、直播與企業資料的稽核能力，以新增欄位／新表／轉換 RPC 取代破壞式改表；遷移必須可重跑、安全失敗並附回滾或修復步驟。
   - 課程採不可變版本：`course` 是商品身份，`course_version` 保存影片、章節、價格、完課分鐘、題庫、積分文案與發布快照；已有付款、指派或學習紀錄的版本不可直接覆寫。
   - 版本 cutover 分三步：先為每門既有課建立 baseline version；再把 lessons、live sessions、order items、entitlements、enrollments、progress、quiz attempts、certificates、企業價格／指派逐表回填 `course_version_id` 並做孤兒／數量／金額核對；最後才設 `NOT NULL`、FK 與 published-version mutation trigger。過渡期所有新寫入必須 dual-write version id，不得長期依賴 nullable fallback。
   - 強制轉版預設不允許自動搬移觀看分鐘、考試或證明。遇法規／重大錯誤時，舊 enrollment 標記 superseded、免費建立新版 entitlement／enrollment、重新完成新版條件；已發證案件需另經撤銷審核。只有逐欄 mapping、影響清單與平台管理員第二人覆核完成後，才可執行例外 carry-forward。
   - 課程內容版本與核定決定完全分離：`accreditation_decision_revisions` 以 append-only revision 連到 `course_version_id`，狀態至少區分 `applying → approved / rejected / expired / extended`，保存決定日期、核定字號、積分、單位與有效區間；核定、展延或退件只新增 revision，不回寫已發布的課程內容版本。學員送審狀態另分 `not_submitted → exported → submitted → accepted / needs_correction / rejected`，不得把「完課」等同「主管機關已登錄積分」。
   - 增加穩定的 `person_id`、auth identity aliases、聯絡信箱驗證、條款同意版本、身分 blind index、帳號合併案件、支援碼、通知 outbox、營運異常、PDF 文件版本及下載稽核等資料。業務 ownership 最終綁 `person_id`；auth user 只是可撤銷的登入身份。
   - 企業點數新增：固定方案、購點訂單、點數批次、課程點數價格、指派、指派拆分明細、座位保留與 append-only 點數事件。每個金額、點數、價格、到期日與課程版本都保存交易快照。
   - 所有金流、發票、觀看、考試、直播、點數、審核、匯出、退款、發證、帳號合併與高風險管理操作使用 append-only event 或不可變快照；摘要可重算，原始事件不可由學員或客服修改。
   - 每張 public table 明確設定 GRANT 與 RLS；private schema 不暴露給瀏覽器。service-role RPC 逐一收窄權限，禁止學員直接寫入訂單、有效分鐘、考試成績、證明、點數餘額或出席摘要。

3. **重做登入、身分與後台權限**

   - 學員登入只提供兩種入口：Supabase Phone Auth 六位數 OTP，以及 LINE Login。手機 OTP 使用 Twilio Verify，設定 10 分鐘有效、60 秒重寄限制、CAPTCHA、IP／門號 rate limit 與濫用告警。
   - LINE Login 以 Supabase Custom OIDC/OAuth provider 串接並允許 provider 不回傳 Email；LINE 可獨立建立帳號，不強迫綁手機。LINE Login channel 與 LINE Official Account 使用同一 provider 並完成正式 callback、隱私政策與服務條款設定。
   - Email 不作登入帳號。第一次付款前，學員與機構必須提供聯絡 Email，透過應用程式產生的六位數短效驗證碼＋Resend 完成驗證，僅用於發票與通知備援。伺服器只保存獨立 secret HMAC，person＋Email 同時只允許一個 active challenge，新發送會 supersede 舊碼；限制錯誤次數，成功時原子 consume，並按 person、Email、IP rate limit。
   - 先完成逐欄 PII inventory：標出 Supabase Auth 必然保存的手機、LINE provider identity metadata、綠界／發票／Twilio／Zoom 必要欄位及各自 retention。LINE scopes 僅取 `openid profile` 與必要 friendship 狀態；刪除 public profile 裡重複的姓名／電話明文。AES-256-GCM 的承諾只適用於歲悅可控制的業務資料，不宣稱能加密第三方 Auth 內部欄位。
   - 姓名、身分證／居留證、長照認證字號、業務用電話、服務單位及人員類別以 AES-256-GCM 加密保存；另以獨立 HMAC key 建 blind index，禁止以未加鹽 SHA 或明文作唯一鍵。每位 person 使用獨立 DEK，加密後由 versioned KEK 包裝；每筆密文保存 DEK reference、KEK id 與 HMAC key id。輪替時並存新舊 blind index，使用可續跑批次重包裝／重加密、逐筆驗證與失敗回滾，完成後才停用舊 key。archive 的 linkable person identifier 改用由該 person DEK 保護的隨機 pseudonym mapping，刪除 DEK 後不可再連回本人。
   - 手機與 LINE 產生重複帳號時不自動搬移歷史。客服建立合併申請，平台管理員把兩個 auth identities 掛到同一 `person_id`、選定主登入、撤銷來源帳號所有 session 並封鎖新登入；訂單、事件與 actor snapshot 保持原值，不重寫 audit history。Auth Admin API 與資料庫操作以可恢復 saga 執行，不宣稱跨系統單一交易。
   - 更換／遺失手機或 LINE 的復原流程：可用舊 factor 時先驗證舊 factor＋新 factor；舊 factor 不可用時，由客服受理、兩位平台管理員核對積分身分與交易證據後核准，設冷卻期並通知所有舊聯絡管道。完成時撤銷全部 session、封鎖舊 alias、綁定新 identity 並寫 takeover audit；僅持有回收門號不得直接取得永久課程或證明。
   - 將指向 `auth.users` 的 `ON DELETE CASCADE` 逐一盤點；訂單、學習、證明與 audit 改綁 `person_id`，原 actor auth id 使用 restrict、nullable＋snapshot 或封存策略，禁止刪除登入身份時連帶刪除歷史。
   - 平台角色固定為平台管理員、課程管理員、客服、財務；機構角色為 owner、manager、member。JWT 的 `app_metadata` 只作快速提示，不作即時撤權的唯一依據；restrictive RLS 與所有敏感 API 必須查詢權威 active identity alias、active membership／staff-role 表，必要時比對 JWT `session_id` 是否仍有效。JWT 設定短效 lifetime，文件化最長殘留窗口。
   - 所有後台角色強制 TOTP 第二步驗證。退款、人工補正、發證、帳號合併、角色變更與敏感匯出除 AAL2 外，還需由伺服器簽發 5 分鐘、綁 actor／action／target／nonce 的 step-up grant，每個 API／RPC 原子消耗或驗證；AAL2 本身不視為「近期確認」。
   - 角色變更、停權、帳號合併與 TOTP 重設後撤銷既有 session。另建立雙人核准的遺失 TOTP 復原與 break-glass 帳號程序，break-glass 預設停用、使用即告警且全程 audit。客服不得 impersonate 學員，只能用一次性短效支援碼查看遮罩後的流程狀態。
   - 建立 default-deny 的 endpoint／RPC permission matrix，逐列標示 learner、organization owner／manager／member、course admin、support、finance、platform admin 能否執行；所有 service-role-backed route 先用資料庫權威角色重新授權。課程發布等四眼操作在交易內強制 `reviewer_person_id <> submitter_person_id`，前端隱藏按鈕不算權限控制。

4. **建立版本化課程後台與 Cloudflare Stream 工作流**

   - 課程管理員可建立課程、版本、章節、單元、講師、試看、Cloudflare Stream direct upload、題庫、抽題數、完課分鐘、B2C 價格、B2B 點數價格、直播場次及積分資料。
   - 影片狀態固定為 `uploading → processing → ready / failed → archived`；付費影片一律 `requireSignedURLs`，已產生學習紀錄的影片只能封存或建立新版，不可物理刪除。
   - 發布檢查硬性驗證：所有必要影片 ready、售價存在、題庫足以抽題且總分可計算、及格分固定 80、必要完課分鐘大於 0、講師與文案完整、積分狀態與揭露文字完整。
   - 課程一律以「長照積分課程」對外呈現；未取得核定字號、積分與核定單位時，課程頁、購物車、付款確認及 PDF 必須醒目顯示「積分申請中，最終積分以主管機關核定結果為準」。不得以樣式或小字隱藏。
   - 最新適用的 approved accreditation decision revision 保存核定生效／失效時間與提早停止販售的 `commerce_close_at`。錄播積分資格的權威日期是 `completed_at`，直播則是正式 `session_starts_at`；兩者都必須落在該 decision revision 的核定有效區間。購買日或 enrollment 日本身不保證積分資格。
   - Cron 在 `commerce_close_at` 停止新 checkout／指派，在核定失效點原子轉為 `expired`；checkout RPC 也自行核對時間，不能只靠 Cron。管理員依課程分鐘與營運承諾設定足夠的完成緩衝並在 30／7／1 天通知未完課者，但不得自行把 grace period 延伸到官方有效期限之外，除非保存主管機關書面展延。
   - 每次 decision revision 新增後，以可重跑批次依 course version、完成／場次日期分類所有既有 enrollment，保存所適用的 decision revision id；核准後為先前 applying enrollment 產生 superseding PDF，退件／展延亦不得修改原 PDF snapshot。
   - 到期時，期限內已完成的 enrollment 仍可送審與取得原核定 snapshot；期限後才完成者不得標示為該期積分合格，改顯示非積分完成 PDF。B2C 由原付款者選擇免費轉到有效新版或全額退款；B2B 學員只能查看與回應課務安排，由 organization owner／manager 決定轉課或將點數按原 allocation components 冪等返還，原 lot 已不可用時建立既定 90 天 compensation lot。直播場次不得排在核定期限外。續期以新 decision revision（內容改變時才建立新 course version）處理，除非主管機關明確允許，不得追溯替舊決定補資格；失效後晚到付款進 `paid_unfulfilled` 並通知處理。
   - 課程管理員送審後，由平台管理員第二人覆核才能發布、下架或建立正式販售版本。既有學員永遠綁購買／指派當下的版本；法規或重大錯誤需強制轉版時，必須填寫原因、逐筆記錄影響並通知學員。

5. **完成 B2C 真實結帳、權限、發票與退款**

   - 所有 B2C 積分課付款前要求：登入、聯絡 Email 已驗證、完整積分個資已提交，以及服務條款／個資告知／積分申請狀態同意。資料可待管理員核對，但缺欄位不得進入付款。
   - 錄播課接受綠界信用卡與 ATM；ATM 繳費期限 3 天，逾期訂單取消且不開通。直播課只接受信用卡，避免 ATM 延遲入帳占住有限座位。
   - 結帳由伺服器重新讀取課程版本與價格，建立不可變 order snapshot。瀏覽器 ReturnURL 只顯示結果；只有通過 CheckMacValue、環境、商店、金額、付款方式與訂單狀態驗證的 server webhook 才能原子地標記付款並建立 entitlement／enrollment。
   - 訂單狀態至少包含 `pending → paid / expired / failed`，以及補償狀態 `paid_unfulfilled → transfer_pending / refund_pending → reconciled`。所有簽章正確的晚到款項都先記帳，絕不可因本地訂單已過期而丟棄；若仍可履約則原子開通，若座位／核定已失效則進財務異常佇列，依使用者鎖定的人工核准流程轉場或退款並設定處理 SLA。
   - webhook、order create、seat hold、entitlement 與發票 outbox 都使用唯一 idempotency key；重送、亂序、同時付款、使用者關頁、付款成功後重登入均不得重複開權限或漏權限。
   - 電子發票與付款分離：付款成功立即開通，發票以獨立冪等 outbox 呼叫綠界 MIG 4.0；失敗安全重試並通知財務，不撤銷已付款權限，且永遠不得重複開票。
   - B2C 發票另建完整 consumer invoice snapshot，不沿用強制統編的企業 payload。第一版支援的發票處置必須在 UX 明列並逐一 mapping：個人電子發票通知、可選手機條碼載具，以及需要統編／抬頭的公司電子發票；不支援的捐贈、紙本或其他載具不得送出。每種處置驗證必填欄位、含稅總額與四捨五入，保存 provider request／response id、issue／void／allowance／ambiguous 狀態並用 production-like fixtures 對帳。
   - B2C 退費採申請＋人工審核。實際條件以台灣法律／會計確認版本為準；退款完成在一個伺服器 workflow 中撤銷 entitlement、關閉 playback／join lease、取消 booking 與未發通知、阻擋新 Stream token／Zoom credential、撤銷證明、排除尚未開始的 completion／export job，最後建立折讓工作。已簽發 token 的最長殘留權限以短 TTL 明確界定並監控。
   - 若積分申請未通過，或核定積分低於付款時揭露內容，所有受影響學員均可選擇免費轉到已核定課程或全額退款，即使已開始觀看；系統必須批次找出影響範圍、通知、追蹤選擇與折讓。

6. **重做錄播有效分鐘與固定 10 分鐘防掛機**

   - Cloudflare 短效簽章播放 token 只發給有效 entitlement；產品不提供官方下載或離線觀看路徑，並隱藏／停用倍速、在伺服器拒絕 `playbackRate != 1` 的有效計時。短效簽章可降低未授權分享，但不能承諾阻止已授權瀏覽器保存串流片段或螢幕錄影；第一版不做 DRM。
   - 同帳號只允許一個有效 playback lease。新裝置接管時明確提示並撤銷舊 lease；多分頁、過期 token、重放 heartbeat 及兩台裝置不得重複累計。
   - 前端每 15 秒送 heartbeat，包含 session nonce、單調序號、媒體位置、播放狀態、頁面前景、網路狀態與伺服器 challenge。伺服器只按可信事件時間與相鄰 heartbeat 差值計算，限制單段最大差值，拒絕倒序、跳號、背景、離線、暫停、倍速或 lease 失效區段。
   - 每個 enrollment＋course version 持久保存 `next_challenge_at_seconds`，初值 600。累積秒數跨 lesson、重播、reload、裝置接管與新 session 共用；在同一資料庫交易跨過門檻時只建立一個 challenge，確認後門檻加 600。結束影片、切換單元或關頁都不能把未完成區間自動結算來避開 challenge。
   - challenge 顯示大按鈕與 60 秒倒數。逾時後播放器暫停、停止累計並要求本人按「繼續觀看」；challenge token 一次性、短效且不可由重送 heartbeat 代替。未處理 challenge 存在時，任何 session 都不得繼續增加有效分鐘。
   - 允許退回已實際看過的位置，不允許跳到尚未有效播放過的前方位置。伺服器保留 `max_verified_position` 與 cumulative seconds 兩種數值，前者管控 seek、後者判斷完課。
   - **依使用者明確決策，重複觀看同一時段會再次累計有效分鐘，且不要求每個必修單元有最低觀看比例。** 因此現有以 `least(duration)` 或 unique coverage 封頂的邏輯要移除；完課只比較課程版本的 `required_watch_seconds` 與累積有效秒數。這項規則必須可稽核並在法規覆核中被明確確認。
   - 斷線、關頁、背景節流、播放器錯誤與 heartbeat 超時均停止計時；恢復後建立新區段，不回補中斷時間。摘要只能由原始 append-only 事件重算。

7. **完成 80 分考試與完課判定**

   - 每個正式課程版本及格線固定為 80，不提供管理員改成其他分數。題庫保存題目版本、選項、正解、解析、章節與配分；已被作答的題目只能停用或建立新版。
   - 每次 attempt 由伺服器按版本隨機抽題並打亂選項；送到瀏覽器的資料不包含正解。提交後由伺服器一次評分並保存完整題目／選項快照、分數、是否通過與時間。
   - 不限補考次數，每次都保留；學員顯示最佳分數與通過狀態。未通過時只顯示分數與需加強章節，不公布正解；通過後才顯示解析。
   - 錄播完課條件為：有效 entitlement、累積有效觀看秒數達版本要求、至少一次考試達 80、積分身分資料人工核對通過。滿意度調查可保留但不得阻擋完課或 PDF。
   - 直播完課條件另加入有效簽到、簽退、在線 80% 與鏡頭 80%；所有條件由伺服器重算，前端不能直接傳送「已通過」。

8. **完成免 Zoom 帳號直播與出席計算**

   - 使用歲悅 Zoom 帳戶的 Server-to-Server OAuth 建立／更新／取消 Meeting，學員透過 Meeting SDK 在網站內加入，不需 Zoom 帳號；支援的桌面瀏覽器使用 Component View，iPhone／Android 及不支援 Component View 的裝置使用 Client View。API 只接受 `liveSessionId`，伺服器驗證 entitlement、場次、時間與付款後才簽發短效 participant signature。
   - 增加講師／主持人 console：只有指定 instructor 或平台管理員可取得 role-1 SDK signature 與短效 ZAK，啟動前檢查 Zoom host 授權、會議狀態、鏡頭／音訊、等候室與備援主持人；所有 ZAK 只在伺服器取得且不寫 log。
   - 建立 `zoom_host_resources` 與 reservation：每個 licensed host 保存官方允許的 concurrent meeting slots；排課以開課前 30 分鐘、結束後 30 分鐘的 buffered range，按固定 host／slot 順序交易鎖定 primary 與不同的 fallback capacity。任一 host 超過授權、primary／fallback 重疊無容量或授權狀態未知時禁止場次發布。
   - 所有改時間、改 primary／fallback host、取消與 Zoom 授權升降級都必須走 locking mutation saga：先鎖場次與 host slots、取得 replacement reservation 並同步 Zoom，確認成功後才釋放舊 reservation。無法取得或對帳不明時標記 `capacity_conflict`、停止新 booking 並保留舊狀態；既有付費 booking 立即進通知、轉場／退款處理，直到 Zoom 與本地狀態 reconcile。
   - 每筆 booking 產生隨機 `customerKey`，並在 Zoom 啟用 registration，為該 booking 建立唯一 registrant token `tk`（或經官方驗證可達同等綁定強度的參與者 credential）；join API 同時驗證單一 active join lease。`customerKey` 只作 webhook correlation，不當作 admission secret；重放 signature、同 booking 雙加入與 participant 對應異常需撤銷／踢除並進入 reconciliation。
   - Zoom webhook 實作 CRC、`x-zm-signature`、時間戳防重放、事件冪等與未知 key 安全拒絕。
   - 每場設定日期、講師、容量、休息區段及狀態；容量不得超過實際 Zoom 授權。付款或選場先保留座位 15 分鐘，逾時釋放；最後一席以交易鎖處理。
   - 簽到窗口為課前 30 分鐘至開課後 15 分鐘；簽退窗口為結束前 15 分鐘至結束後 30 分鐘。簽到前檢查鏡頭、麥克風與喇叭；異常只能申請人工覆核，不能自動判合格。
   - SDK 每 15 秒回報本人鏡頭 on/off；只有 Zoom webhook 顯示仍在會議且 heartbeat 間隔不超過 45 秒才計入。正式休息排除分母，在線秒數及鏡頭秒數均須達有效課程時間 80%。鏡頭 on/off 明確標示為「client/device-reported evidence」，不是伺服器影像證明；偵測不可能切換、固定間隔偽造、多人共用與 SDK／Zoom 狀態矛盾，交由講師／管理員覆核。若此證據決定正式積分，主管機關對此保證等級的書面接受是 launch blocker。
   - 直播不再跳 10 分鐘防掛機。只保存加入／離開、heartbeat 與鏡頭狀態時間，不截圖、不錄影、不做人臉辨識；原始 Zoom／SDK 事件不可修改，人工補正只能追加原因與調整事件。
   - 學員可在場次開始前自行換到有空位場次；完成簽到或場次已開始後不得自行換場。個人原因缺席原則上不退款、不退點，只能申請人工例外。
   - 歲悅取消場次時，B2C 可選全額退款或免費轉場；B2B 自動退回原點數批次。若取消時原批次剩餘效期少於 90 天（包含已到期），不修改舊 lot，而是建立只承接該次退回額度、從取消日算 90 天的 compensation lot；原效期仍超過 90 天則退回原 lot。

9. **把既有企業名額系統遷移為 B2B 點數錢包**

   - 機構申請提供名稱、統編、聯絡人、電話與發票 Email；統編唯一。首次申請必須經平台管理員人工核准後，owner／manager 才能購點、邀請、匯入及指派。
   - 第一版只販售管理員設定的固定點數方案，不允許任意輸入金額；1 點＝NT$1，不做贈點、折扣碼或買多送多。信用卡與 ATM 都可購點，ATM 期限 3 天。
   - 付款 webhook 在同一交易建立點數 lot；每 lot 自付款日起一年到期，扣點依最早到期優先。到期前 30 天及 7 天通知機構，expire job 只處理尚未使用餘額。
   - 每個課程版本可設定一個有生效期間的企業點數價格。指派時伺服器重新讀價、保存價格快照，依 `expires_at, created_at, id` 的固定順序鎖住足額 lots，建立 allocation components 與 append-only debit events；餘額以 ledger 重算，不接受前端數字。
   - 錄播在第一分鐘有效觀看、直播在簽到時，把指派狀態原子轉為 consumed。此前機構可取消指派，按原 lot 與原到期日追加 release event；若資料庫權威 `now() >= expires_at`，釋放額度直接記為 expired、不可重新使用。開始後不能收回。已有相同錄播永久權限或相同直播 booking 時不得重複扣點。
   - expiry job、一般 release、歲悅取消 compensation、refund 與 correction 都用相同 deterministic lot lock order；每個 allocation component＋原因只有一個唯一 idempotency key。歲悅取消優先在同一交易釋放／建立 compensation lot，再讓 expiry job 處理未涉及餘額；任何重試只讀既有 ledger 結果。
   - 直播選場與點數扣除、booking 容量確認在單一交易或可補償的 saga 內完成；錯誤不得出現「已扣點但沒座位」或「有座位但沒扣點」。
   - 只允許退尚未指派、未使用、未到期的點數，採人工審核；退款以原始付款批次與 1:1 金額計算，完成後扣除 lot 餘額並開立發票折讓。已開始觀看、直播簽到或已發證的部分不得退款。
   - Excel 匯入先預覽欄位、重複 Email、格式與公式注入問題，全部通過後才建立邀請。邀請 token 使用雜湊、單次、7 天到期；接受時必須先以手機／LINE 登入，再驗證邀請 Email 與目前帳號聯絡 Email 相符，才在同一交易 claim membership 與匯入資料。轉寄連結、重放或 Email 不符都拒絕；管理員例外綁定需 step-up、理由與 audit。
   - 機構可匯入完整長照資料，但前台只顯示遮罩；學員本人仍須確認資料與同意個資用途，管理員人工核對後才可發證。
   - 員工離職後，已開始或已完成的課程、成績與證明留在個人帳號；機構只保留其依法／契約可保存的歷史培訓成果，不得控制個人帳號。

10. **完成積分審核、送審、PDF 與敏感匯出**

   - 積分資料狀態使用 `draft → submitted → verified / needs_correction / rejected`。管理員人工核對文字資料，不要求或保存身分證照片；客服及機構只看「未填、待審、已驗證、待補正」與遮罩值。
   - 當身分資料 verified、有效分鐘／直播出席達標、考試通過時，只呼叫一個 enrollment-locking completion RPC：先 `FOR UPDATE` 鎖 enrollment、重查 entitlement／refund／version 條件，以 compare-and-set 轉 completed，再於同一交易建立唯一 active certificate revision 與 PDF outbox。heartbeat、考試、審核、出席與 refund 只觸發此 RPC，不各自發證；資料庫限制同一 enrollment 同時最多一個 active revision。
   - PDF worker 由上述 outbox 產生不可變 certificate snapshot 與唯一證明編號，伺服器嵌入繁中字型，保存課程版本、姓名、完成日期、核定／申請中狀態、核定字號／積分／單位快照與文件 hash。worker 開始前再次核對 active revision，退款／撤銷後不得發布競態中的文件。
   - 第一版只提供登入後的短效 PDF 下載，不提供公開 QR 驗證頁。原始證明不覆寫；核定狀態變更時建立 superseding PDF 版本，退款或舞弊則標記撤銷並保留歷史。
   - PDF 代表「完成課程」，不代表主管機關已登錄積分。學習中心另顯示送審狀態；管理員以每門課程版本、直播則再加指定場次，建立獨立送審批次。
   - Excel 匯出包含資格統整、考核結果、有效分鐘／直播出席、補正與必要原始事件；不混合不同課程版本、核定資料或直播場次。保存匯出人、用途、時間、筆數、filter snapshot 與 SHA-256。
   - 含完整個資的匯出只能由具 action-scoped step-up grant 的管理員下載，不用 Email 附件傳送；客服無權取得。不要把 Supabase Storage signed URL 當成一次性連結：應用程式保存 capability hash、actor、purpose、expiry、consumed_at，下載 endpoint 在交易中原子消耗 capability 後才從 private Storage 串流一次，重放立即拒絕。Excel 公式字元、日期、時區、身分證格式與前導零需有測試。
   - 個資、學習稽核與送審紀錄預設自完課或最後交易日起保留 7 年，屆期依資料類型刪除或去識別；若主管機關／法律要求不同，以核准規則調整 retention job 並留下處理證明。

11. **建立 LINE 優先的交易與直播通知**

   - 第一版自動通知涵蓋購買／購點結果與直播營運事件。直播至少包含購課確認、課前 24 小時、課前 1 小時、場次改期、取消及退款／轉場選擇；改期事件以 `live_session_id + schedule_revision` 作冪等鍵，任何時間／地點變更都必須立即建立通知。
   - LINE Messaging API 的 HTTP 200 只代表 provider 接受，不視為實際送達。一般課前提醒可採 LINE 優先 fallback；付款／購點、場次改期、取消與退款／轉場選擇等關鍵事件，除 LINE 外固定再寄已驗證 Email，有手機者另寄 SMS。每個 channel 各自記錄結果，全部替代管道失敗或 Email bounce 進 alerted dead-letter queue。Email 仍不是登入方式。
   - 所有訊息透過持久化 outbox，以業務事件 idempotency key 防重複；保存 channel、provider message id、attempt、結果與錯誤分類。可重試錯誤採退避重試，永久錯誤進營運異常佇列。
   - 不在 log、前端錯誤或第三方 metadata 放身分證、長照字號、完整電話或不必要個資。

12. **完成高齡友善學員端與四類營運工作台**

   - 學員端以手機優先，內文至少 18px、主要觸控區至少 48px、一步一件事、清楚返回／下一步、明確倒數與錯誤復原，不依賴 hover、複雜手勢或小圖示。
   - B2C 路徑：手機／LINE 登入 → 補齊聯絡與積分資料 → 同意 → 付款 → 看課 → 防掛機 → 考試 → 資料審核 → PDF／送審狀態。
   - B2B 路徑：機構申請 → 審核 → 固定方案購點 → 發票 → 邀請／匯入 → 指派／選場 → 員工確認資料 → 追蹤 → 報表。
   - 直播路徑：倒數 → 設備檢查 → 簽到 → 網站內教室 → 簽退 → 出席審核 → 考試 → PDF／送審狀態。
   - 後台分成平台、課程、客服、財務視角；每一頁只顯示該角色必要資料。客服可看異常與遮罩狀態，不能改成合格；財務可處理付款／發票／折讓，不能看考試答案或身分明文。

13. **加入可靠性、安全與營運控制**

   - 每條業務線分開設 commerce switch、assignment／booking switch 與 emergency admission switch。前兩者停止新交易但不影響既有權限；admission switch 只有安全事故才可阻擋已付款直播入場，啟用時必須建立受影響 booking 清單、立即通知並啟動轉場／退款義務，不再宣稱所有 kill switch 都不影響既有學員。
   - 所有缺少正式憑證的整合預設 fail closed，不得以模擬成功對外收費。
   - 監控綠界 webhook、發票 outbox、Cloudflare processing、LINE／Twilio、Zoom webhook、Cron、有效分鐘重算、點數 ledger、PDF 與匯出；連續失敗立即通知指定的平台管理、客服、財務與工程窗口。
   - 除顯性錯誤外，為「沉默失效」設定 SLO／告警：應有 webhook 卻長時間為零、callback age、outbox oldest age／depth、paid 無 entitlement、invoice ambiguous、seat sold 與 capacity 不一致、point lot balance 與 ledger sum 不一致、原始事件重算與摘要漂移、Cron freshness、PDF／export backlog。每個告警指定 owner、嚴重度、確認時間、處置 runbook 與對帳查詢。
   - 啟用 Supabase 時間點復原與每日備份，上線前實際做一次還原演練；定義資料庫與 Storage 的 RPO/RTO、金鑰輪替與舊資料重加密程序。
   - 依 500 位同時觀看、每 15 秒 heartbeat 建立至少 2,000 次／分鐘的 ingest 預算與 7 年 retention matrix。原始 learning／live events 依月份（必要時再依 course hash）partition。小型、未分區的 global dedup registry 只處理綠界、發票、LINE、Cloudflare、Zoom 等低頻 provider webhook；高頻 heartbeat 以 playback／join session 的 monotonic sequence compare-and-set 去重。去重狀態與事件 payload 必須在同一資料庫交易寫入，不能出現 registry 成功但事件遺失。
   - 近期分區供查核，舊分區轉 immutable archive 並保存 manifest／hash。個資刪除不是同步抹除所有 PITR：主資料先刪除／匿名化，archive 以 per-person DEK crypto-shredding，寫入 tombstone ledger；刪除 manifest 另存於與 production Supabase 不同備份／還原域的 append-only control plane，包含不可逆 person reference、時間、範圍與 hash，不含可還原明文。任何資料庫 restore 必須先隔離，從控制面 replay 全部有效 tombstones 並完成核對，才可對外服務；備份依文件化 retention 自然 age out。
   - 正式站設定 CSP、安全 cookie、CSRF／origin 檢查、webhook replay window、API rate limit、secret scanning、依賴弱點掃描與敏感 log redaction。
   - 上線前由獨立工程師或第三方完成安全檢查，至少測登入、帳號連結、RLS 越權、付款與發票 webhook、個資加密、匯出、Zoom、點數競態及後台權限；高風險問題未修正不得公開。

14. **依風險順序開發，但三線同日正式公開**

   - 實作順序固定為：共用登入／身分／條款／金流基礎 → B2C 錄播 → B2B 點數 → 直播 → 跨流程報表與營運控制。
   - 每一段完成 unit、API integration、資料庫 transaction／RLS、瀏覽器 E2E 與失敗注入，再開啟下一段；順序只是降低風險，最終 B2C、B2B、直播仍在同一公開日啟用。
   - 效能驗收目標為 500 位同時使用網站、單場直播 100 人；直播人數永遠不得高於實際 Zoom 授權。壓測須涵蓋 heartbeat、presence challenge、付款狀態查詢、最後座位與點數交易鎖。

15. **封閉測試、上線門檻與驗收證據**

   - 先在完整隔離環境做自動測試：手機 OTP／LINE、Email challenge 重放／猜碼、帳號復原／合併、短效 JWT 後的權威撤權、角色與 action-scoped step-up、課程版本、Cloudflare webhook、有效分鐘、固定 10 分鐘 challenge、重複時段計分、seek、防雙裝置、80 分考試、單一 active PDF、積分狀態、企業 ledger 到期邊界、綠界付款、ATM 逾期、發票重試、退款折讓、Zoom 主持人／registrant／client-reported 鏡頭異常與通知 cascade。
   - 競態測試至少包括：低頻 webhook 重送與跨月 global dedup、高頻 heartbeat sequence CAS、同訂單並發付款、信用卡／ATM 晚到付款、同帳號雙播放器、跨單元／reload 避開第 600 秒 challenge、同機構同時扣最後點數、release／expire／compensation 同時發生、多人搶直播最後一席、取消／付款／到期同時發生、退款撞上發證／匯出、LINE callback 重送及帳號合併衝突。
   - Migration 測試必須同時從乾淨資料庫與舊 schema＋代表性資料升級，核對 schema fingerprint、baseline course version 回填數量、所有 FK／NOT NULL、person alias、訂單總額、點數餘額、證明與 audit 數量；任何孤兒或 checksum 不一致即中止。
   - 手機實測涵蓋 iPhone Safari／Android Chrome 的 Meeting SDK Client View、桌面 Chrome／Edge 的 Component View、大字體、慢網路、registration token 加入、背景分頁、斷線重連、相機／麥克風拒絕、LINE 內建瀏覽器與 OTP 自動填入。
   - 核定到期測試涵蓋販售關閉、期限前後完成、期限內直播／期限外直播、書面展延、新版續期、晚到付款、非積分 PDF、轉課與全額退款；Zoom 另測多場重疊、primary 故障切 fallback、host 授權降級與 buffered range 邊界。
   - 封閉測試規模固定為 10 位 B2C、2 家機構各至少 5 位員工、1 門錄播、2 場直播；使用真實小額付款、真實電子發票、退款與折讓。測試金額由財務設定為合法的非零商品價格並保存核准紀錄。
   - 公開門檻：三條完整流程均成功，金流／發票／計時／點數／直播／發證無重大錯誤；完成 500 人壓測、第三方安全檢查、從獨立控制面 replay tombstone 的備份還原演練、LINE 接受但替代管道實際送達測試、台灣法律與會計審核，以及四類營運責任窗口演練。
   - 正式公開前，所有下列資料／帳號必須 ready：同一收款與發證法人、正式網域、Supabase production、ECPay 金流與 MIG 4.0、LINE Login 與 Official Account、Twilio Verify／Messaging、Cloudflare Stream、Zoom S2S／Meeting SDK 授權、寄信網域、正式課程影片／題庫／講師／積分揭露、服務條款／個資告知／退費與發票規則。

## Key decisions & tradeoffs

- B2C 錄播、B2B 點數與直播三線同日真實收費；開發仍按風險分段。每條業務線分別具有 commerce、assignment／booking 與 emergency admission 開關，阻擋已付款入場時必須啟動通知、轉場／退款義務。
- 所有課程對外稱「長照積分課程」。尚未核定也可販售，但必須在課程頁、付款與 PDF 醒目標示申請中；未核定或積分縮水提供轉課或全額退款。這提高了營運與法規風險，必須取得專業審核。
- 核定資格以錄播完成時間／直播正式場次時間是否落在有效區間判斷，不以購買日保留資格；到期前提早停賣並通知，逾期完成只能取得明示非積分的完成 PDF，另提供有效新版轉課或全額退款。
- 錄播以累積有效分鐘為完課核心；重播同一時段可重複計分，也不要求每個必修單元最低覆蓋率。這是使用者明確接受的取捨，可能削弱送審證據，實作不能暗中改回 unique coverage。
- 防掛機固定每 600 秒有效播放一次，60 秒未確認後暫停；禁止倍速、官方下載／離線功能與未觀看位置快轉，同帳號只允許一個有效播放器。短效簽章不等於 DRM，不能保證阻止螢幕錄影。
- 考試固定 80 分、不限補考、隨機抽題與選項；未通過不顯示正解。滿意度不是發證條件。
- 登入採手機 OTP 與可獨立存在的 LINE 帳號，不使用 Email／密碼登入；聯絡 Email 仍須在付款前驗證。一般提醒 LINE 優先；付款、購點、改期、取消與退款選擇採 LINE＋已驗證 Email，另對有手機者發 SMS，避免把 LINE provider acceptance 誤當成送達。
- 積分個資由 B2C 付款前填寫，B2B 可由機構匯入；學員本人仍須確認，管理員人工核對，但不收身分證影像。
- B2B 採固定點數方案，1 點＝NT$1、無促銷、一年到期、FIFO 扣點；指派即扣點，開始前可退回原批次，開始後即 consumed。
- 錄播與 B2B 購點支援信用卡／ATM；直播只支援信用卡或 B2B 點數。付款是權限唯一來源，發票失敗不阻擋已付款權限。
- 直播不需 Zoom 帳號；簽到、簽退、在線 80%、鏡頭 80% 缺一不可。只記錄狀態與時間，不截圖、錄影或做人臉辨識，也不另跳防掛機。
- PDF 只代表課程完成；主管機關積分登錄另有狀態。第一版只提供登入後 PDF，不提供 QR／公開驗證頁，但保留唯一編號、hash、版本與撤銷紀錄。
- 錄播啟用後永久觀看；員工離職仍保有個人成果。因歲悅下架時提供替代內容或依規則退款。
- 退費、人工出席補正、帳號合併與資料匯出均採人工授權＋append-only audit，不做無人監督的自動退款或客服代登入。

## Risks / open questions

- **重複觀看可無限累計是最大合規風險。** 主管機關或核定單位若要求完整內容覆蓋，本規則可能不被接受。上線前必須取得書面或可保存的專業確認；若不被接受，需建立新課程版本並明確變更規則，不能竄改舊紀錄。
- **「積分申請中」仍以長照積分課程販售有誤解與退費風險。** 公開文案、付款確認、退費承諾及 PDF 用語必須由台灣法律專業人員核准；審核未完成即為 launch blocker。
- 尚待歲悅提供的不是設計選項，而是上線輸入：法人正式名稱／統編、正式課程與售價、積分申請或核定資料、講師與題庫、綠界／發票／LINE／Twilio／Cloudflare／Zoom／寄信正式帳號及密鑰。任何缺項只阻擋相應 feature，程式必須 fail closed。
- 官方積分送審 Excel 格式與外部登錄 API 尚未取得。先用可版本化 exporter 與欄位 mapping 實作；正式格式到手後需以新 adapter 與 golden file 驗證，不修改既有原始事件。
- LINE Login 使用 custom OIDC/OAuth，LINE 通知另依賴 Official Account friendship 與 Messaging API；必須實測 LINE 內建瀏覽器、未加好友、封鎖帳號、無手機 LINE-only 帳號與 callback 重放。
- Twilio 台灣簡訊到達率、發送者規則與費用需用真實門號驗證；若正式測試不合格，替換供應商必須走相同 notification／OTP adapter，不改領域流程。
- 第一版沒有公開證明驗證頁，第三方無法即時確認 PDF 是否撤銷；風險由唯一編號、文件 hash 與內部客服查核暫時承擔。
- 目前工作區有 migration 刪除／重命名與多個未提交修改。實作前必須先比對遠端 migration history，避免把本機檔名調整誤當成可在正式資料庫重播的基線。

## Out of scope

- iOS／Android 原生 App、影片下載、離線觀看、倍速播放與同帳號多播放器。
- 要求每個必修影片達最低觀看比例或只計 unique coverage；目前明確採可重複累計分鐘。
- Zoom 帳號要求、雲端錄影、直播回放、截圖、人臉辨識、影像內容分析與直播每 10 分鐘防掛機。
- 公開 QR 證明驗證頁、紙本證明郵寄，以及以滿意度作為發證門檻。
- 企業 SSO、HR 系統串接、月結請款、訂閱、跨課點數兌換比率、贈點、折扣碼、買多送多與任意金額購點。
- 自動退款、無人工核准的出席補正、客服 impersonation、以 Email／密碼登入。
- LINE／簡訊的行銷推播；第一版只做購買／購點與直播提醒。
- 主管機關積分平台的自動送件或查核 API；未有正式規格前採受控 Excel 與人工更新狀態。
- 混合式「錄播＋直播合併為同一完課條件」課程；錄播與直播各自獨立完成。
