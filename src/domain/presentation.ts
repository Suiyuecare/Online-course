export type StatusPresentation = {
  label: string;
  description: string;
  nextAction: string | null;
  tone: "neutral" | "warning" | "success" | "danger";
};

const orderStatuses: Record<string, StatusPresentation> = {
  contract_review: {
    label: "契約審閱中",
    description: "尚未完成第二次契約確認，因此還沒有匯款訂單。",
    nextAction: "請於 72 小時審閱期後回到契約頁完成第二次確認。",
    tone: "warning",
  },
  pending_transfer: {
    label: "等待匯款",
    description: "尚未確認收到款項，課程不會先開通。",
    nextAction: "請在期限內完成匯款，再送出匯款資料。",
    tone: "warning",
  },
  proof_submitted: {
    label: "已送出匯款資料",
    description: "財務會比對銀行實際入帳；匯款資料本身不能開通課程。",
    nextAction: "請留意通知；若資料不符，系統會請你補正。",
    tone: "neutral",
  },
  payment_review: {
    label: "財務核對中",
    description: "款項正在由授權財務人員核對。",
    nextAction: "目前不需重複送出，請等候核對結果。",
    tone: "neutral",
  },
  needs_correction: {
    label: "需要補件",
    description: "目前資料不足以確認匯款。",
    nextAction: "請依通知補正匯款人、帳號末五碼、金額或匯款時間。",
    tone: "warning",
  },
  paid: {
    label: "付款已確認",
    description: "銀行實際入帳已確認。",
    nextAction: "請到「我的課程」開始或繼續上課。",
    tone: "success",
  },
  paid_unfulfilled: {
    label: "已收款，開通處理中",
    description: "款項已確認，但課程權限尚未安全建立。",
    nextAction: "請勿重複付款；客服會處理開通或退款。",
    tone: "danger",
  },
  expired: {
    label: "匯款期限已過",
    description: "這張訂單已失效，不能再用它取得課程權限。",
    nextAction: "若尚未匯款，請重新建立訂單；若已匯款，請聯絡客服。",
    tone: "danger",
  },
  cancelled: {
    label: "訂單已取消",
    description: "這張訂單不再接受付款。",
    nextAction: "如仍要上課，請回課程頁重新購買。",
    tone: "neutral",
  },
  rejected: {
    label: "付款資料未通過",
    description: "目前無法用這筆資料確認付款。",
    nextAction: "請查看通知中的原因；已實際匯款時請勿重複付款。",
    tone: "danger",
  },
  refund_pending: {
    label: "退款處理中",
    description: "未使用點數已依規則凍結，等待雙人審核與實際匯回。",
    nextAction: "請等待通知，不需重複申請。",
    tone: "warning",
  },
  partially_refunded: {
    label: "部分退款已完成",
    description: "部分款項或未使用點數已完成退款。",
    nextAction: "請查看退款明細與剩餘點數。",
    tone: "neutral",
  },
  refund_requested: {
    label: "退款申請已送出",
    description: "退款將依已提供的服務與購買時揭露規則計算。",
    nextAction: "請等待審核；網站通知中心會保留每一步結果。",
    tone: "warning",
  },
  refunded: {
    label: "退款已完成",
    description: "退款處理已完成，相關權限依規則撤銷。",
    nextAction: null,
    tone: "neutral",
  },
};

const enrollmentStatuses: Record<string, StatusPresentation> = {
  active: {
    label: "上課中",
    description: "課程權限有效。",
    nextAction: "繼續完成下一個尚未完成的步驟。",
    tone: "neutral",
  },
  completed: {
    label: "已完課",
    description: "平台的觀看、出席、測驗及滿意度條件已完成。",
    nextAction: "積分仍須經送審與主管機關結果確認。",
    tone: "success",
  },
  submitted: {
    label: "積分送審中",
    description: "完課資料已送交認可流程。",
    nextAction: "請等待主管機關結果；這不是已取得積分。",
    tone: "warning",
  },
  credited: {
    label: "積分已登錄",
    description: "主管機關結果已回填為積分登錄完成。",
    nextAction: "可下載積分證明並使用 QR 查驗。",
    tone: "success",
  },
  needs_correction: {
    label: "積分資料待補正",
    description: "送審資料需要修正或補充。",
    nextAction: "請依通知補正，不需重看已有效認列的課程。",
    tone: "warning",
  },
  rejected: {
    label: "積分未通過",
    description: "主管機關或審核流程未認列此次積分。",
    nextAction: "請查看通知中的原因與可補救方式。",
    tone: "danger",
  },
  revoked: {
    label: "資格已撤銷",
    description: "此修課資格已被撤銷。",
    nextAction: "請查看通知或聯絡客服了解原因。",
    tone: "danger",
  },
  refunded: {
    label: "已退款",
    description: "修課權限已依退款結果處理。",
    nextAction: null,
    tone: "neutral",
  },
};

const certificateStatuses: Record<string, StatusPresentation> = {
  active: {
    label: "完課證明有效",
    description: "這只證明已完成平台課程條件，不代表積分已登錄。",
    nextAction: null,
    tone: "success",
  },
  submitted: {
    label: "完課證明有效・積分送審中",
    description: "完課成立，但積分仍等待主管機關結果。",
    nextAction: "請等待積分登錄結果。",
    tone: "warning",
  },
  credited: {
    label: "積分證明有效",
    description: "主管機關積分結果已回填並可查驗。",
    nextAction: null,
    tone: "success",
  },
  revoked: {
    label: "證明已撤銷",
    description: "此證明目前無效。",
    nextAction: "請聯絡歲悅學苑確認撤銷原因。",
    tone: "danger",
  },
};

const organizationStatuses: Record<string, StatusPresentation> = {
  submitted: {
    label: "機構審核中",
    description: "平台管理員尚未完成首次審核。",
    nextAction: "審核前不會開放錢包、邀請或員工資料。",
    tone: "warning",
  },
  approved: {
    label: "機構已核准",
    description: "可依角色使用購點、邀請、指派與報表。",
    nextAction: null,
    tone: "success",
  },
  rejected: {
    label: "機構申請未通過",
    description: "申請資料未通過審核。",
    nextAction: "請依通知修正資料或聯絡客服。",
    tone: "danger",
  },
  suspended: {
    label: "機構功能已暫停",
    description: "目前不能購點、邀請或建立新指派。",
    nextAction: "既有紀錄仍保留；請聯絡客服處理。",
    tone: "danger",
  },
};

const unknown: StatusPresentation = {
  label: "狀態確認中",
  description: "系統收到尚未對應的狀態，沒有因此開放任何權限。",
  nextAction: "請重新整理；若持續出現，請聯絡客服。",
  tone: "warning",
};

export function presentStatus(
  kind: "order" | "enrollment" | "certificate" | "organization",
  status: string | null | undefined,
): StatusPresentation {
  if (!status) return unknown;
  const source =
    kind === "order"
      ? orderStatuses
      : kind === "enrollment"
        ? enrollmentStatuses
        : kind === "certificate"
          ? certificateStatuses
          : organizationStatuses;
  return source[status] ?? unknown;
}

const errorMessages: Record<string, string> = {
  RATE_LIMITED: "嘗試次數太多，請稍候再試。",
  OTP_REQUEST_REJECTED: "簡訊服務暫時無法寄送，請稍後再試。",
  OTP_VERIFICATION_REJECTED: "驗證碼不正確或已過期，請重新確認。",
  TURNSTILE_REQUIRED: "請先完成人機驗證。",
  ORIGIN_REQUIRED: "連線驗證失敗，請重新整理頁面再試。",
  ORIGIN_REJECTED: "連線來源不符，請從歲悅學苑頁面重新操作。",
  AUTHENTICATION_REQUIRED: "登入已失效，請重新登入。",
  FEATURE_CLOSED: "此功能尚未完成上線檢查，目前安全關閉。",
  PROVIDER_NOT_READY: "外部服務尚未準備完成，目前不會接受此操作。",
  DATABASE_REJECTED: "資料狀態不符合操作條件，沒有變更任何權限或款項。",
  SERVICE_NOT_CONFIGURED: "服務尚未完成設定，目前安全關閉。",
  TOTP_NOT_ENROLLED: "尚未設定管理員驗證器，請先完成後台安全設定。",
  TOTP_REQUIRED: "請輸入驗證器 App 顯示的六位數代碼。",
  STEP_UP_REJECTED: "敏感操作驗證失敗，請重新完成驗證器確認。",
  EXPORT_NOT_AUTHORIZED: "這筆送審資料尚未符合匯出或雙人覆核條件。",
  EXPORT_CAPABILITY_INVALID: "一次性下載權限無效或已使用，請重新產生。",
  EXPORT_DOWNLOAD_REJECTED: "送審檔未下載；一次性權限可能已過期。",
  PREREQUISITE_DECISION_REJECTED:
    "先決資料未完成覆核；建立者不能核准自己的草稿。",
  EMERGENCY_SUSPEND_REJECTED: "緊急暫停未執行；請確認管理員權限與雙重驗證。",
};

export function presentErrorCode(code: unknown, fallback: string): string {
  if (typeof code !== "string") return fallback;
  return errorMessages[code.split(":")[0]] ?? fallback;
}
