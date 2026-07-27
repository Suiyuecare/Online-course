import Image from "next/image";
import Link from "next/link";
import { CourseCard } from "@/components/course-card";
import { catalogCourses } from "@/infrastructure/supabase/catalog";

export const revalidate = 60;

export default async function Home() {
  const courses = (await catalogCourses()).slice(0, 3);
  return (
    <>
      <section className="hero shell">
        <div>
          <p className="eyebrow">手機就能安心完成</p>
          <h1>
            長照進修，
            <br />
            每一步都清楚。
          </h1>
          <p className="lead">
            從手機驗證、人工匯款、上課，到測驗、滿意度與證明，一步一步陪你完成。
          </p>
          <div className="button-row">
            <Link className="button" href="/courses">
              找長照積分課程
            </Link>
            <Link className="text-link" href="/learner">
              查看我的課程
            </Link>
          </div>
          <ul className="trust-list">
            <li>錄播每 10 分鐘確認在席</li>
            <li>同步直播保存出席證據</li>
            <li>積分登錄與完課狀態分開顯示</li>
          </ul>
        </div>
        <div className="hero-card">
          <Image
            alt="歲悅學苑牛奶盒標誌"
            height={180}
            priority
            src="/suiyue-milk.png"
            width={180}
          />
          <p>字大、步驟少、狀態說清楚</p>
          <strong>不熟悉手機，也能自己完成</strong>
        </div>
      </section>

      <section className="steps shell" aria-labelledby="steps-title">
        <div className="section-heading">
          <p className="eyebrow">簡單四步驟</p>
          <h2 id="steps-title">從報名到取得證明</h2>
        </div>
        <ol>
          <li>
            <span>1</span>
            <h3>手機登入</h3>
            <p>輸入台灣手機號碼與簡訊驗證碼。</p>
          </li>
          <li>
            <span>2</span>
            <h3>閱讀契約、匯款</h3>
            <p>匯款資料送出後，由財務確認實際入帳。</p>
          </li>
          <li>
            <span>3</span>
            <h3>完成課程</h3>
            <p>觀看、出席、測驗與滿意度都有清楚進度。</p>
          </li>
          <li>
            <span>4</span>
            <h3>查詢證明</h3>
            <p>完課與主管機關積分登錄狀態不混淆。</p>
          </li>
        </ol>
      </section>

      <section className="catalog-section shell">
        <div className="section-heading horizontal">
          <div>
            <p className="eyebrow">長照積分課程</p>
            <h2>目前開放課程</h2>
          </div>
          <Link className="text-link" href="/courses">
            查看全部
          </Link>
        </div>
        {courses.length > 0 ? (
          <div className="course-grid">
            {courses.map((course) => (
              <CourseCard course={course} key={course.slug} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>課程正在準備中</h3>
            <p>正式課程要完成核定、法律、財務與供應商檢查後才會出現在這裡。</p>
          </div>
        )}
      </section>

      <section className="organization-banner shell">
        <div>
          <p className="eyebrow">機構培訓</p>
          <h2>點數不過期，指派與成果清楚可查</h2>
          <p>一元一點、人工匯款購點；只看機構出資的培訓紀錄。</p>
        </div>
        <Link className="button secondary" href="/organization">
          進入機構專區
        </Link>
      </section>
    </>
  );
}
