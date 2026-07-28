import Image from "next/image";
import Link from "next/link";
import { CourseCard } from "@/components/course-card";
import { ShowcaseCourseCard } from "@/components/showcase-course-card";
import { showcaseCourses } from "@/content/showcase-courses";
import { catalogCourseListing } from "@/infrastructure/supabase/catalog";

export const revalidate = 60;

const homeCategories = [
  ["記", "失智照護", "理解行為、溝通與安心陪伴"],
  ["策", "長照政策", "服務架構、申請與資源轉介"],
  ["食", "營養吞嚥", "進食觀察與吞嚥安全"],
  ["動", "復能活動", "關節活動與生活化復能"],
  ["評", "健康評估", "長者六力與異常觀察"],
  ["淨", "感染管制", "手部衛生與機構安全"],
] as const;

export default async function Home() {
  const catalog = await catalogCourseListing();
  const courses = catalog.courses.slice(0, 3);
  return (
    <>
      <section className="hero shell">
        <div className="hero-copy">
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
        <figure className="hero-photo">
          <Image
            alt="照護工作者陪伴長者進行團體活動"
            fill
            priority
            sizes="(max-width: 900px) 100vw, 42vw"
            src="/images/suiyue-original/home-hero-care-activity.jpg"
          />
          <figcaption>
            <span>課程、進度、測驗</span>
            <strong>一支手機就能完成</strong>
          </figcaption>
        </figure>
      </section>

      <section className="home-proof-band" aria-label="平台學習機制">
        <div className="shell">
          <article>
            <strong>10 分鐘</strong>
            <span>錄播在席確認</span>
          </article>
          <article>
            <strong>80 分</strong>
            <span>預設測驗門檻</span>
          </article>
          <article>
            <strong>3 種</strong>
            <span>錄播、直播、混合課</span>
          </article>
          <article>
            <strong>1 個中心</strong>
            <span>查看分鐘、成績與證明</span>
          </article>
        </div>
      </section>

      <section className="category-section shell">
        <div className="section-heading horizontal">
          <div>
            <p className="eyebrow">常見進修主題</p>
            <h2>從每天遇到的照護情境開始</h2>
          </div>
          <Link className="text-link" href="/courses">
            瀏覽全部課程
          </Link>
        </div>
        <div className="category-grid">
          {homeCategories.map(([icon, title, description]) => (
            <Link
              href={`/courses?category=${encodeURIComponent(title)}#course-showcase`}
              key={title}
            >
              <span aria-hidden="true">{icon}</span>
              <strong>{title}</strong>
              <small>{description}</small>
            </Link>
          ))}
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

      {courses.length > 0 && (
        <section className="catalog-section shell official-catalog-section">
          <div className="section-heading horizontal">
            <div>
              <p className="eyebrow">正式開放報名</p>
              <h2>已完成發布檢查的課程</h2>
            </div>
            <Link className="text-link" href="/courses">
              查看正式課程
            </Link>
          </div>
          <div className="course-grid">
            {courses.map((course) => (
              <CourseCard course={course} key={course.slug} />
            ))}
          </div>
        </section>
      )}

      <section className="catalog-section shell">
        <div className="section-heading horizontal">
          <div>
            <p className="eyebrow">課程視覺示範</p>
            <h2>看看完整課程會怎麼呈現</h2>
            <p>可進入課程頁、查看大綱並播放官方公開影片；目前不接受報名。</p>
          </div>
          <Link className="text-link" href="/courses">
            查看全部
          </Link>
        </div>
        <div className="course-grid">
          {showcaseCourses.slice(0, 6).map((course) => (
            <ShowcaseCourseCard course={course} key={course.slug} />
          ))}
        </div>
      </section>

      <section className="learning-mechanics">
        <div className="shell">
          <div className="section-heading">
            <p className="eyebrow">不是只把影片放上網</p>
            <h2>每一步都有紀錄，也知道下一步要做什麼</h2>
          </div>
          <div className="mechanics-grid">
            <article>
              <span>01</span>
              <h3>看影片、記分鐘</h3>
              <p>暫停、背景分頁與逾時區段不會被誤算成有效學習。</p>
            </article>
            <article>
              <span>02</span>
              <h3>10 分鐘確認在席</h3>
              <p>提示會暫停影片；完成確認後，才繼續認列觀看區段。</p>
            </article>
            <article>
              <span>03</span>
              <h3>完成測驗與回饋</h3>
              <p>成績、補考、滿意度與缺少項目，都在同一頁看得到。</p>
            </article>
            <article>
              <span>04</span>
              <h3>取得與查驗證明</h3>
              <p>完課證明和積分登錄狀態分開，避免把兩件事混為一談。</p>
            </article>
          </div>
        </div>
      </section>

      <section className="organization-story shell">
        <div>
          <p className="eyebrow">機構培訓</p>
          <h2>買點數、派課、看成果，不必再整理好多份表格</h2>
          <p>
            機構以一元一點購買點數，依課程扣點後指派給員工；只查看機構出資的培訓紀錄。
          </p>
          <ul>
            <li>手機號碼邀請員工，不建立另一套企業帳密</li>
            <li>錄播、直播、混合課都能統一指派</li>
            <li>分鐘、成績、出席與證明可依部門追蹤</li>
          </ul>
          <Link className="button secondary" href="/organization">
            看機構培訓方式
          </Link>
        </div>
        <figure>
          <Image
            alt="長照機構主管與照護團隊一起查看線上培訓進度"
            fill
            sizes="(max-width: 900px) 100vw, 42vw"
            src="/images/suiyue-original/organization-training-team.jpg"
          />
          <figcaption>
            培訓資料整理好，照護團隊才有更多時間陪伴長者。
          </figcaption>
        </figure>
      </section>
    </>
  );
}
