import Link from "next/link";

export default function OrganizationLanding() {
  return (
    <section className="page-shell shell organization-page">
      <div className="organization-intro">
        <p className="eyebrow">歲悅機構培訓</p>
        <h1>點數不過期，培訓紀錄不混在一起</h1>
        <p className="lead">
          機構用同一個手機 OTP
          登入，人工匯款購點、邀請員工、指派課程與查看機構出資的成果。
        </p>
        <Link className="button" href="/organization/workspace">
          進入機構工作台
        </Link>
      </div>
      <div className="principle-grid">
        <article>
          <strong>NT$1 = 1 點</strong>
          <p>整數點數、沒有贈點或級距 bonus，未使用點數不過期。</p>
        </article>
        <article>
          <strong>只看出資紀錄</strong>
          <p>看不到員工個人購買、其他機構、完整證號或調查文字。</p>
        </article>
        <article>
          <strong>手機邀請</strong>
          <p>單筆或 Excel 先預覽錯誤，全部通過後才建立邀請。</p>
        </article>
      </div>
    </section>
  );
}
