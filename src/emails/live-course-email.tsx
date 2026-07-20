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

export function LiveCourseEmail({
  learnerName,
  courseTitle,
  sessionTitle,
  startsAt,
  classroomUrl,
  kind,
}: {
  learnerName: string;
  courseTitle: string;
  sessionTitle: string;
  startsAt: string;
  classroomUrl: string;
  kind: "purchase_confirmation" | "reminder_24h" | "reminder_1h";
}) {
  const lead =
    kind === "purchase_confirmation"
      ? "直播課購買成功"
      : kind === "reminder_24h"
        ? "直播課將於 24 小時內開始"
        : "直播課將於 1 小時內開始";
  return (
    <Html>
      <Head />
      <Preview>
        {lead}：{courseTitle}
      </Preview>
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
          <Heading style={{ fontSize: 26, lineHeight: 1.35 }}>{lead}</Heading>
          <Text>{learnerName} 您好，</Text>
          <Text style={{ lineHeight: 1.8 }}>
            您報名的「{courseTitle}
            」已安排以下同步場次。上課只需登入歲悅學苑，不必建立 Zoom 帳號。
          </Text>
          <Container
            style={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #EADFCF",
              borderRadius: 14,
              padding: 20,
            }}
          >
            <Text style={{ margin: 0, fontWeight: 800 }}>{sessionTitle}</Text>
            <Text style={{ marginBottom: 0 }}>{formatTaipei(startsAt)}</Text>
          </Container>
          <Button
            href={classroomUrl}
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
            前往設備檢查與同步教室
          </Button>
          <Hr style={{ margin: "28px 0", borderColor: "#EADFCF" }} />
          <Text style={{ color: "#6F5E4E", fontSize: 13, lineHeight: 1.7 }}>
            簽到時間為課前 30 分鐘至開課後 15
            分鐘。請預留時間測試攝影機、麥克風與喇叭；會議密碼不會透過 Email
            傳送。
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
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
