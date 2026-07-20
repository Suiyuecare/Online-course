import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from "@react-email/components";

export type EnterpriseEmailKind =
  | "organization_review"
  | "invitation"
  | "assignment"
  | "live_session"
  | "deadline"
  | "completion"
  | "invoice"
  | "refund";

export type EnterpriseEmailTemplateProps = {
  kind: EnterpriseEmailKind;
  organizationName: string;
  learnerName?: string;
  decision?: "approved" | "rejected" | "suspended";
  refundDecision?: "paid" | "rejected";
  reason?: string;
  courseTitle?: string;
  sessionTitle?: string;
  sessionStartsAt?: string;
  dueAt?: string;
  invoiceNumber?: string;
  amountTwd?: number;
  actionUrl?: string;
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
}

function copyFor(props: EnterpriseEmailTemplateProps) {
  switch (props.kind) {
    case "organization_review": {
      const decision =
        props.decision === "approved"
          ? "機構申請已通過"
          : props.decision === "suspended"
            ? "機構服務已暫停"
            : "機構申請需要調整";
      return {
        title: decision,
        lead:
          props.decision === "approved"
            ? `「${props.organizationName}」現在可以購買企業名額、邀請成員與指派課程。`
            : `「${props.organizationName}」目前尚無法使用企業購課與指派功能。`,
        action: props.decision === "approved" ? "前往機構工作台" : null,
      };
    }
    case "invitation":
      return {
        title: `邀請您加入${props.organizationName}`,
        lead:
          "接受邀請後，您可以沿用歲悅學苑帳號查看機構指派的課程，不需要建立另一組帳密。",
        action: "接受機構邀請",
      };
    case "assignment":
      return {
        title: "您有新的企業培訓課程",
        lead: `「${props.organizationName}」已指派您修習「${props.courseTitle ?? "歲悅學苑課程"}」。`,
        action: "前往學習中心",
      };
    case "live_session":
      return {
        title: "直播課場次已安排",
        lead: `您在「${props.organizationName}」的企業培訓已安排直播場次。登入歲悅學苑即可上課，不需要 Zoom 帳號。`,
        action: "查看直播場次",
      };
    case "deadline":
      return {
        title: "企業培訓期限提醒",
        lead: `「${props.courseTitle ?? "指派課程"}」即將到期，請預留時間完成觀看、測驗與滿意度。`,
        action: "繼續上課",
      };
    case "completion":
      return {
        title: "企業培訓已完成",
        lead: `您已完成「${props.courseTitle ?? "指派課程"}」，成果已同步到「${props.organizationName}」的機構報表。`,
        action: "查看學習成果",
      };
    case "invoice":
      return {
        title: "企業購課電子發票已開立",
        lead: `「${props.organizationName}」的企業購課電子發票已完成開立。`,
        action: "查看訂單與發票",
      };
    case "refund":
      return props.refundDecision === "rejected"
        ? {
            title: "企業名額退費申請未通過",
            lead: `「${props.organizationName}」的企業名額退費申請已完成審核，本次申請未通過；原因請見下方說明。`,
            action: "查看退費紀錄",
          }
        : {
            title: "企業名額退費已完成",
            lead: `「${props.organizationName}」的企業名額退費已完成；若原訂單已開立發票，折讓狀態會顯示於機構工作台。`,
            action: "查看退費紀錄",
          };
  }
}

export function EnterpriseEmail(props: EnterpriseEmailTemplateProps) {
  const copy = copyFor(props);
  return (
    <Html>
      <Head />
      <Preview>{copy.title}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: "#FFF8ED",
          fontFamily: "Arial, 'Noto Sans TC', sans-serif",
          color: "#302318",
        }}
      >
        <Container
          style={{ maxWidth: 560, margin: "0 auto", padding: "36px 24px" }}
        >
          <Text style={{ color: "#B45309", fontWeight: 800, letterSpacing: 2 }}>
            歲悅學苑
          </Text>
          <Heading style={{ fontSize: 26, lineHeight: 1.35 }}>
            {copy.title}
          </Heading>
          <Text>
            {props.learnerName?.trim()
              ? `${props.learnerName.trim()} 您好，`
              : "您好，"}
          </Text>
          <Text style={{ lineHeight: 1.8 }}>{copy.lead}</Text>

          {(props.courseTitle ||
            props.sessionTitle ||
            props.sessionStartsAt ||
            props.dueAt ||
            props.invoiceNumber ||
            props.amountTwd) && (
            <Container
              style={{
                backgroundColor: "#FFFFFF",
                border: "1px solid #EADFCF",
                borderRadius: 14,
                padding: 20,
              }}
            >
              {props.courseTitle && (
                <Text style={{ margin: "0 0 8px", fontWeight: 800 }}>
                  課程：{props.courseTitle}
                </Text>
              )}
              {props.sessionTitle && (
                <Text style={{ margin: "0 0 8px" }}>
                  場次：{props.sessionTitle}
                </Text>
              )}
              {props.sessionStartsAt && (
                <Text style={{ margin: "0 0 8px" }}>
                  上課時間：{formatTaipei(props.sessionStartsAt)}
                </Text>
              )}
              {props.dueAt && (
                <Text style={{ margin: "0 0 8px" }}>
                  完成期限：{formatTaipei(props.dueAt)}
                </Text>
              )}
              {props.invoiceNumber && (
                <Text style={{ margin: "0 0 8px" }}>
                  發票號碼：{props.invoiceNumber}
                </Text>
              )}
              {typeof props.amountTwd === "number" && (
                <Text style={{ margin: 0 }}>
                  金額：{formatMoney(props.amountTwd)}
                </Text>
              )}
            </Container>
          )}

          {props.reason && (
            <Text
              style={{
                marginTop: 18,
                borderLeft: "4px solid #EA880C",
                paddingLeft: 12,
                lineHeight: 1.7,
              }}
            >
              說明：{props.reason}
            </Text>
          )}

          {copy.action && props.actionUrl && (
            <Button
              href={props.actionUrl}
              style={{
                display: "block",
                marginTop: 24,
                borderRadius: 10,
                backgroundColor: "#B45309",
                color: "#FFFFFF",
                fontWeight: 800,
                textAlign: "center",
                padding: "14px 20px",
              }}
            >
              {copy.action}
            </Button>
          )}

          <Hr style={{ margin: "28px 0", borderColor: "#EADFCF" }} />
          <Text style={{ color: "#6F5E4E", fontSize: 13, lineHeight: 1.7 }}>
            這是歲悅學苑的企業培訓交易通知。若您不認識這個機構，請不要點擊邀請連結，並與歲悅客服聯繫。
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
