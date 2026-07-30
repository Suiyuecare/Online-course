import type { OrganizationWorkspaceDetails } from "@/application/workspace";
import { presentStatus } from "@/domain/presentation";

const roleLabels: Record<string, string> = {
  owner: "機構負責人",
  training_manager: "培訓管理員",
  finance: "財務",
  member: "員工",
};

const simpleStatusLabels: Record<string, string> = {
  pending: "待處理",
  sent: "已寄出",
  accepted: "已接受",
  revoked: "已撤銷",
  expired: "已過期",
  pending_transfer: "等待匯款",
  proof_submitted: "已送匯款資料",
  payment_review: "財務核對中",
  paid: "已確認",
  active: "進行中",
  reserved: "已保留",
  consumed: "已使用",
  completed: "已完成",
  released: "已收回",
  refunded: "已退款",
  issued: "已開立",
  failed: "處理失敗",
  credited: "積分已登錄",
  submitted: "送審中",
  needs_correction: "待補正",
};

function label(value: string) {
  return simpleStatusLabels[value] ?? "狀態確認中";
}

export function OrganizationRecords({
  details,
}: {
  details: OrganizationWorkspaceDetails;
}) {
  return (
    <div className="organization-records">
      {details.capabilities.canViewTraining && (
        <>
          <section>
            <h2>員工與邀請</h2>
            <div className="record-list">
              {details.members.map((member) => (
                <article key={member.personId}>
                  <strong>{member.displayName}</strong>
                  <span>
                    {roleLabels[member.role] ?? "成員"}・
                    {member.status === "active" ? "有效" : "已離職"}
                  </span>
                  <p>
                    {member.employeeNumber ?? "未填員工編號"}・
                    {member.department ?? "未填部門"}
                  </p>
                </article>
              ))}
              {details.invitations.map((invitation) => (
                <article key={invitation.invitationId}>
                  <strong>{invitation.maskedPhone}</strong>
                  <span>邀請：{label(invitation.status)}</span>
                  <p>
                    {roleLabels[invitation.role] ?? "員工"}・有效至{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString("zh-TW")}
                  </p>
                </article>
              ))}
              {details.members.length === 0 &&
                details.invitations.length === 0 && (
                  <p className="closed-note">尚無員工或待接受邀請。</p>
                )}
            </div>
          </section>
          <section>
            <h2>課程指派與直播</h2>
            <div className="record-list">
              {details.assignments.map((assignment) => (
                <article key={assignment.assignmentId}>
                  <strong>{assignment.courseTitle}</strong>
                  <span>{label(assignment.status)}</span>
                  <p>
                    {assignment.memberLabel}・{assignment.points} 點
                  </p>
                  {assignment.completionDueAt && (
                    <p>
                      完成期限：
                      {new Date(assignment.completionDueAt).toLocaleString(
                        "zh-TW",
                        { timeZone: "Asia/Taipei" },
                      )}
                    </p>
                  )}
                </article>
              ))}
              {details.liveBookings.map((booking) => (
                <article key={booking.bookingId}>
                  <strong>{booking.sessionTitle}</strong>
                  <span>{label(booking.status)}</span>
                  <p>
                    {booking.memberLabel}・
                    {new Date(booking.startsAt).toLocaleString("zh-TW")}
                  </p>
                </article>
              ))}
              {details.assignments.length === 0 &&
                details.liveBookings.length === 0 && (
                  <p className="closed-note">尚無課程指派或直播選場。</p>
                )}
            </div>
          </section>
          <section>
            <h2>員工學習成果</h2>
            <div className="record-list">
              {details.outcomes.map((outcome) => {
                const accreditation = presentStatus(
                  "enrollment",
                  outcome.accreditationStatus,
                );
                return (
                  <article key={outcome.assignmentId}>
                    <strong>{outcome.courseTitle}</strong>
                    <span>{accreditation.label}</span>
                    <p>
                      {outcome.memberLabel}・進度 {outcome.progressPercent}
                      %・有效 {outcome.validMinutes} 分鐘
                      {outcome.quizScore === null
                        ? ""
                        : `・測驗 ${outcome.quizScore} 分`}
                    </p>
                  </article>
                );
              })}
              {details.outcomes.length === 0 && (
                <p className="closed-note">尚無可顯示的機構出資課程成果。</p>
              )}
            </div>
          </section>
        </>
      )}
      {details.capabilities.canViewFinance && (
        <section>
          <h2>購點與發票</h2>
          <div className="record-list">
            {details.topups.map((topup) => (
              <article key={topup.topupId}>
                <strong>{topup.referenceNumber}</strong>
                <span>{label(topup.status)}</span>
                <p>
                  {topup.points.toLocaleString("zh-TW")} 點・NT${" "}
                  {topup.amountTwd.toLocaleString("zh-TW")}
                </p>
              </article>
            ))}
            {details.invoices.map((invoice) => (
              <article key={invoice.invoiceId}>
                <strong>{invoice.externalNumber ?? "發票號碼待補"}</strong>
                <span>{label(invoice.status)}</span>
                <p>NT$ {invoice.amountTwd.toLocaleString("zh-TW")}</p>
              </article>
            ))}
            {details.topups.length === 0 && details.invoices.length === 0 && (
              <p className="closed-note">尚無購點或發票紀錄。</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
