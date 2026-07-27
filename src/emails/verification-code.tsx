export function VerificationCodeEmail({ code }: { code: string }) {
  return (
    <html lang="zh-Hant">
      <body style={{ backgroundColor: "#fff8ed", fontFamily: "sans-serif" }}>
        <div
          style={{
            display: "none",
            maxHeight: 0,
            overflow: "hidden",
          }}
        >
          歲悅學苑 Email 驗證碼
        </div>
        <main
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e6d4bd",
            borderRadius: "16px",
            margin: "32px auto",
            maxWidth: "520px",
            padding: "28px",
          }}
        >
          <h1 style={{ color: "#713500" }}>驗證聯絡 Email</h1>
          <p>請在 10 分鐘內輸入以下六位數驗證碼：</p>
          <div
            style={{
              backgroundColor: "#f8ead5",
              borderRadius: "12px",
              fontSize: "32px",
              fontWeight: "bold",
              letterSpacing: "8px",
              padding: "18px",
              textAlign: "center",
            }}
          >
            {code}
          </div>
          <p>若不是你本人操作，請忽略此信。歲悅不會向你索取密碼。</p>
        </main>
      </body>
    </html>
  );
}
