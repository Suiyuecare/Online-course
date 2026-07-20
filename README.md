# 歲悅學苑

歲悅學苑錄播、同步直播與企業機構培訓平台。第四階段新增企業自助流程：

`機構申請 → 歲悅首次審核 → 企業級距刷卡 → 統編電子發票 → Email／Excel 邀請 → 指派錄播或直播場次 → 學習追蹤 → 機構 Excel 報表`

## 已完成

- 歲悅橘色品牌：`#EA880C`、奶油色 `#FFF8ED`，白字主按鈕使用可讀性較高的 `#B45309`
- 既有歲悅牛奶盒 Logo 與 1200×630 LINE／Facebook 分享圖
- Supabase Google OAuth、Email 六位數 OTP 與 PKCE callback
- `app_metadata.platform_role` 的學員／客服／管理員角色
- 綠界 AioCheckOut V5 測試／正式網址環境鎖定、官方 CheckMacValue 範例測試、金額核對、冪等付款通知
- 付款瀏覽器返回不解鎖；只有驗證成功的 ReturnURL 才建立 entitlement 與 enrollment
- Cloudflare Stream 200MB 以下 direct upload、處理 webhook 簽章、影片 ready 才能發布
- 短效 signed playback URL、同帳號單一播放工作階段與裝置接管提示
- heartbeat、頁面前景、網路狀態與在席確認的伺服器權威有效時數
- preview 每 2 分鐘、production 固定每 15 分鐘在席確認
- 80 分測驗、補考、滿意度、90% 有效觀看門檻與 QR 完課證明
- 人工退款申請／核銷 API；退款後撤銷權限並保留 append-only 稽核紀錄
- 正式積分課 AES-256-GCM 個資、遮罩客服畫面、補正與管理員驗證
- 多課程目錄、每單元續播、可調 60–100 分及格標準與觀看門檻
- 正式課發布前檢查核定狀態、字號、積分、100 分完整題庫與所有付費影片
- 每門課獨立送審 Excel，包含資格、考核／滿意度及原始學習事件並保存 SHA-256 校驗碼
- `@zoom/meetingsdk` 6.2.0 Component View；學員只需歲悅帳號，Meeting SDK JWT 只接受 `liveSessionId`
- Zoom Server-to-Server OAuth 自動建會議、更新與取消；會議密碼以 AES-256-GCM 保存於 private schema
- Zoom webhook CRC、`x-zm-signature`、五分鐘防重放、事件冪等與隨機 `customerKey` 學員對照
- 同課多場次、名額上限、交易鎖保留最後席次、逾時釋放、人工轉班與取消場次稽核
- 課前設備檢查、簽到退窗口、15 秒鏡頭心跳、45 秒中斷上限、正式休息排除與 80% 出席門檻
- 原始 Zoom／SDK 事件 append-only；管理員補正只新增更正，客服只有讀取權限
- 購課確認、課前 24 小時與 1 小時 Resend 提醒，以及每場 `.ics` 行事曆
- 直播積分 Excel 強制 `courseId + liveSessionId`，分列資格、原始事件、休息與人工補正
- 機構申請、owner／manager／member 權限、單筆與 Excel 邀請、一次性雜湊 token 與 7 天期限
- 多機構成員可安全切換工作台；機構停權後，前台 API 與 RLS 同步停止企業自助資料存取
- Excel 匯入先預覽再建立，保護 owner 建立的 manager 邀請；部分寄送失敗可只重試失敗 Email
- 每課數量級距、15 分鐘報價快照、企業信用卡結帳，以及付款 webhook 原子建立名額與發票 outbox
- 金流與 MIG 4.0 電子發票環境必須同為測試或正式；設定不一致時結帳會安全拒絕
- 一年效期課程名額批次、append-only 名額帳本、錄播指派／收回與直播選場／24 小時改場
- 機構工作台、學習追蹤、發票與退費狀態，以及「培訓摘要、員工成果、直播出席、名額異動」四工作表報表
- 折讓 ReturnURL 使用綠界發票規格的 MD5 檢查碼；逾期未同意或結果不明時需管理員填寫查核依據後才能重試或補登
- 企業退費申請採 UUID 冪等鍵；付款、名額、退費決策、發票／折讓與管理操作都留下不可覆寫稽核
- Resend 通知使用持久化 delivery outbox；可重建的失敗通知由每小時排程安全重試
- 企業心跳首次有效觀看、名額消耗與秒數寫入在同一資料庫交易完成；客服無法透過 Data API 繞過遮罩畫面讀取原始付款、Zoom 或學習事件
- 訂閱、LINE／簡訊、紙本發票、企業 SSO、月結請款、錄影與 RTMS 仍不啟用

沒有外部金鑰時，登入、付款、影音、webhook 與權限 API 都會安全拒絕；前台仍可使用明確標示的預覽模式。

## 本機啟動

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

開啟 <http://localhost:3000>。

如果系統沒有 `pnpm`，可使用工作區內建 runtime：

```bash
/Users/seniorlifepr/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm dev
```

## 外部服務設定順序

1. 建立 Supabase 測試專案並依檔名順序套用 migration（最後一份為 `20260719160746_phase_four_enterprise_training.sql`）。
2. Auth Email 範本必須使用 `{{ .Token }}` 顯示六位數 OTP；Google callback 加入 `/auth/callback` allowlist。
3. 將管理員的 `app_metadata.platform_role` 設為 `admin`；客服設為 `support`，不可使用 user metadata 授權。
4. 設定 Cloudflare Stream API token、customer code 與 webhook secret。
5. 產生並安全保存 32-byte 積分個資加密金鑰：`openssl rand -hex 32`，寫入 `LEARNER_DATA_ENCRYPTION_KEY`。正式資料產生後不可直接更換；輪替前必須先完成資料重加密。
6. 登入 `/admin/courses` 建立課程、章節、單元與題庫，上傳影片並等待 ready；積分課填完核定資料後才可發布。
7. 設定綠界測試 MerchantID、HashKey、HashIV；ReturnURL 為 `/api/webhooks/ecpay`。
8. 建立 Zoom Server-to-Server OAuth 與 General App 的 Meeting SDK 憑證，訂閱 meeting started/ended、participant joined/left webhook；Callback 指向 `/api/webhooks/zoom`。
9. Zoom 帳戶需把「誰可以分享」設為「僅主持人」、關閉學員改名與雲端自動錄影；API 另固定加入靜音、10 分鐘提早入場及 `auto_recording=none`。
10. 產生直播密碼加密金鑰：`openssl rand -hex 32`，寫入 `LIVE_SECRET_ENCRYPTION_KEY`。
11. 驗證 Resend 寄件網域，設定 `RESEND_API_KEY`、`RESEND_FROM_EMAIL` 與隨機 `CRON_SECRET`；Vercel Cron 每小時執行提醒與清理逾時座位。
12. 將同一組環境變數加入 Vercel Preview，以非積分內部場完成全流程，再測一場積分課；確認 Zoom 報表與歲悅出席秒數後才把正式環境 `FEATURE_LIVE_COURSES` 設為 `true`。
13. 啟用綠界 MIG 4.0 測試電子發票，設定 `ECPAY_INVOICE_*`；測試環境不得填真實客戶 Email。正式切換時同時將 `ECPAY_ENV` 與 `ECPAY_INVOICE_ENV` 設為 `production`，不可自訂其他金流主機。
14. 先以內部錄播機構、再以非積分直播機構、最後正式積分機構完成驗證，才將 `FEATURE_ENTERPRISE` 設為 `true`。

環境變數範本在 `.env.example`。未設定 Zoom、直播加密金鑰或功能開關時，入場與 webhook 會安全拒絕，不會洩漏會議資訊。

## 主要頁面

| 路徑                                | 用途                                   |
| ----------------------------------- | -------------------------------------- |
| `/`                                 | 歲悅品牌首頁                           |
| `/courses/dementia-care-pilot`      | NT$100 非積分測試課介紹                |
| `/login`                            | Google／Email 六位數登入               |
| `/checkout/dementia-care-pilot`     | 綠界測試結帳                           |
| `/dashboard`                        | 訂單、進度、測驗與證明                 |
| `/learn/dementia-care-pilot`        | 受保護播放器與在席確認                 |
| `/quiz/dementia-care-pilot`         | 測驗、補考與滿意度                     |
| `/certificate/demo`                 | 完課證明樣張與 QR 驗證                 |
| `/admin`                            | 影片上傳、發布與串接狀態               |
| `/admin/courses`                    | 多課程、章節、影片版本、題庫與發布檢查 |
| `/accreditation/[courseSlug]`       | 學員積分資料填寫、補正與狀態           |
| `/admin/accreditation?courseId=...` | 單課積分審核與送審 Excel               |
| `/live/[sessionId]`                 | 設備檢查、簽到退與網站內 Zoom 教室    |
| `/admin/live`                       | 場次排課、Zoom、名額與狀態            |
| `/admin/live/[sessionId]`           | 出席異常、人工補正與轉班              |
| `/enterprise`                       | 機構申請、邀請、購買、指派與報表       |
| `/enterprise/invite/[token]`        | 員工一次性邀請接受                 |
| `/admin/enterprise`                 | 機構審核、級距、發票與退費異常       |

## 資料與安全

- Migration：`supabase/migrations/20260719040126_initial_learning_platform_schema.sql`
- 封閉測試增量：`supabase/migrations/20260719044059_closed_beta_core.sql`
- 正式積分課增量：`supabase/migrations/20260719063101_phase_two_accreditation_operations.sql`
- 同步直播增量：`supabase/migrations/20260719100323_phase_three_live_courses.sql`
- 企業機構增量：`supabase/migrations/20260719160746_phase_four_enterprise_training.sql`
- 全部 public tables 啟用 RLS；付款、影音與學習寫入由伺服器 secret client 執行
- 學員不能直接 insert/update learning events、playback segments、quiz attempts、orders 或 satisfaction
- payment events、learning events、audit events 不提供學員 update/delete policy
- 已有 playback history 的單元不可刪除，只能下架或建立影片新版
- 身分證、長照字號、電話與服務單位使用 AES-256-GCM 保存於未暴露的 `private` schema；瀏覽器與客服 API 只取得遮罩
- 正式證明保存核定字號、積分與核定單位快照；退款會撤銷證明但保留稽核紀錄
- 直播正式證明另保存場次日期與鏡頭門檻快照；訂單、entitlement 與 enrollment 都綁指定場次
- 直播原始 webhook、出席事件與人工補正皆禁止 update/delete；出席摘要只能由伺服器重算
- 企業名額事件只追加不覆寫；購買數量、單價、級距與發票資料均保留結帳快照
- 機構報表只限當前機構，不包含身分證、長照字號、測驗作答與原始敏感事件

Supabase 2026 年新專案不再自動把新資料表暴露到 Data API；`supabase/config.toml` 保持安全預設，migration 明確建立必要權限。

## 驗證

```bash
pnpm test
pnpm lint
pnpm build
```

目前 43 項自動測試包含綠界官方 SHA256 付款檢查碼與 MD5 折讓回呼檢查碼、積分資格判定、AES-256-GCM 防竄改、Zoom CRC／簽章／過期防重放，以及鏡頭 79.9%／80%、休息排除、45 秒斷線、企業 Excel 公式防護、名額更正、環境鎖定與安全導向。本機未安裝 Docker／未啟動 Supabase 時無法執行 migration lint 與 RLS 整合測試；連結測試專案後執行：

```bash
supabase db push
supabase db lint --linked --level warning
```

再依計畫測試 OTP 過期、搶最後席次、付款逾時、Zoom webhook 重送、未知 customerKey、多分頁、iPhone／Android 相機權限、每課 70／80 分、個資明文不可見、逐場匯出、退款撤權、轉班與三種角色越權。RLS、service-role RPC 及綠界／Cloudflare／Zoom 真實事件必須在測試專案通過後才能開正式收費。

## 品牌素材

- `public/suiyue-milk.png`：既有歲悅牛奶盒 Logo
- `public/og.png`：內建影像生成模式產出的 1200×630 分享圖
