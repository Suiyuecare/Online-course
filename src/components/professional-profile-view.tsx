import Link from "next/link";
import type {
  ProfessionalProfilePageData,
  ProfileCourse,
} from "@/application/professional-profile";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { ProfessionalProfileMedia } from "@/components/professional-profile-media";
import { ProfileCourseCard } from "@/components/profile-course-card";
import { ProfileShareButton } from "@/components/profile-share-button";

function CourseSection({
  courses,
  eyebrow,
  title,
  empty,
  hidden,
}: {
  courses: ProfileCourse[];
  eyebrow: string;
  title: string;
  empty: string;
  hidden: boolean;
}) {
  return (
    <section className="professional-profile-course-section">
      <div className="professional-profile-section-heading">
        <div>
          <p>{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {hidden ? (
          <span>
            <LearnerPortalIcon name="eye" size={18} />
            公開頁不顯示
          </span>
        ) : (
          <strong>{courses.length} 門</strong>
        )}
      </div>
      {courses.length > 0 ? (
        <div className="professional-profile-course-grid">
          {courses.map((course) => (
            <ProfileCourseCard
              course={course}
              key={`${course.courseVersionId}-${course.statusLabel}`}
            />
          ))}
        </div>
      ) : (
        <div className="professional-profile-empty">
          <LearnerPortalIcon name="book" size={30} />
          <p>{empty}</p>
        </div>
      )}
    </section>
  );
}

export function ProfessionalProfileView({
  data,
  mode,
  actions,
}: {
  data: ProfessionalProfilePageData;
  mode: "owner" | "preview" | "public";
  actions?: React.ReactNode;
}) {
  const { profile } = data;
  const ownerMode = mode === "owner";
  const previewMode = mode === "preview";
  const canShowAbout = ownerMode || profile.showAbout;
  const canShowCompleted = ownerMode || profile.showCompletedCourses;
  const canShowTeaching = ownerMode || profile.showTeachingCourses;
  const mediaSlug = mode === "public" ? (profile.slug ?? undefined) : undefined;
  const publicPath = profile.slug ? `/profiles/${profile.slug}` : null;
  const stats = [
    {
      label: "已完成課程",
      value:
        ownerMode || profile.showCompletedCourses ? data.completedCount : "—",
    },
    {
      label: "結訓證明",
      value:
        ownerMode || profile.showCompletedCourses ? data.certificateCount : "—",
    },
    {
      label: "授課課程",
      value:
        ownerMode || profile.showTeachingCourses ? data.teachingCount : "—",
    },
  ];

  return (
    <div className="professional-profile-canvas">
      {previewMode && (
        <div className="professional-profile-preview-bar">
          <div>
            <strong>
              {profile.isPublic ? "這是訪客會看到的畫面" : "這是尚未公開的預覽"}
            </strong>
            <span>
              {profile.isPublic
                ? "尚未開放的區塊不會出現在公開頁，也不會顯示正式身分資料。"
                : "目前只有你看得到；回到編輯頁開啟「公開個人頁」後，分享網址才會生效。"}
            </span>
          </div>
          <Link href="/learner/account">返回編輯</Link>
        </div>
      )}
      <header className="professional-profile-hero">
        <div className="professional-profile-cover">
          <ProfessionalProfileMedia
            hasMedia={profile.hasCover}
            kind="cover"
            priority
            publicName={profile.publicName}
            publicSlug={mediaSlug}
            updatedAt={profile.updatedAt}
          />
        </div>
        <div className="professional-profile-hero-bottom">
          <div className="professional-profile-avatar">
            <ProfessionalProfileMedia
              hasMedia={profile.hasAvatar}
              kind="avatar"
              publicName={profile.publicName}
              publicSlug={mediaSlug}
              updatedAt={profile.updatedAt}
            />
          </div>
          <div className="professional-profile-hero-identity">
            <p>長照專業個人頁</p>
            {ownerMode ? (
              <h2>{profile.publicName}</h2>
            ) : (
              <h1>{profile.publicName}</h1>
            )}
            <span>{profile.headline || "分享你的照護專長與學習歷程"}</span>
          </div>
          <div className="professional-profile-visibility">
            <span
              className={
                profile.isPublic && !profile.moderationHidden
                  ? "is-public"
                  : undefined
              }
            >
              <i />
              {profile.moderationHidden
                ? "暫停公開"
                : profile.isPublic
                  ? "公開中"
                  : "只有你看得到"}
            </span>
          </div>
          {actions ? (
            <div className="professional-profile-actions">{actions}</div>
          ) : publicPath && profile.isPublic ? (
            <ProfileShareButton
              path={publicPath}
              title={`${profile.publicName}｜歲悅學苑`}
            />
          ) : null}
        </div>
      </header>

      <div className="professional-profile-body">
        <aside className="professional-profile-sidebar">
          <dl className="professional-profile-stats">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>

          {canShowAbout ? (
            <div className="professional-profile-about">
              <section>
                <h2>關於我</h2>
                <p>
                  {profile.biography ||
                    (ownerMode
                      ? "還沒有自我介紹，新增幾句讓大家更認識你。"
                      : "這位學員尚未填寫自我介紹。")}
                </p>
              </section>
              <section>
                <h2>自己的專長</h2>
                {profile.expertise.length > 0 ? (
                  <ul>
                    {profile.expertise.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>尚未新增專長</p>
                )}
              </section>
              <section>
                <h2>感興趣的主題</h2>
                {profile.interests.length > 0 ? (
                  <ul>
                    {profile.interests.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>尚未新增感興趣的主題</p>
                )}
              </section>
              {profile.websiteUrl && (
                <a
                  href={profile.websiteUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <LearnerPortalIcon name="link" size={19} />
                  前往個人網站
                </a>
              )}
            </div>
          ) : (
            <div className="professional-profile-private-block">
              <LearnerPortalIcon name="eye" size={22} />
              <div>
                <strong>個人介紹未公開</strong>
                <p>自介、專長、興趣與網站連結只有本人看得到。</p>
              </div>
            </div>
          )}

          {ownerMode && (
            <div className="professional-profile-privacy-note">
              <strong>正式身分資料不會公開</strong>
              <p>
                姓名、手機、身分證、長照字號、服務單位、觀看分鐘與考試分數仍由加密流程保護。
              </p>
            </div>
          )}
        </aside>

        <section
          aria-label="專業學習成果"
          className="professional-profile-showcase"
        >
          <div className="professional-profile-story-card">
            <span>
              <LearnerPortalIcon name="certificate" size={30} />
            </span>
            <div>
              <p>歲悅學苑學習歷程</p>
              <h2>把持續進修，變成看得見的專業累積</h2>
              <p>
                只展示你主動公開的完成課程；未完成課程、進度、成績與購買紀錄不會出現在這裡。
              </p>
            </div>
          </div>

          {canShowCompleted ? (
            <CourseSection
              courses={data.completedCourses}
              empty="完成課程後，可以選擇把成果展示在個人頁。"
              eyebrow="學習成果"
              hidden={ownerMode && !profile.showCompletedCourses}
              title="我修畢的課"
            />
          ) : null}

          {data.isInstructor && canShowTeaching ? (
            <CourseSection
              courses={data.teachingCourses}
              empty="平台審核並綁定課程後，授課內容會出現在這裡。"
              eyebrow="講師專區"
              hidden={ownerMode && !profile.showTeachingCourses}
              title="我開的課"
            />
          ) : null}

          {ownerMode && data.isInstructor && (
            <Link
              className="professional-profile-instructor-link"
              href="/instructor"
            >
              <span>
                <LearnerPortalIcon name="plus" size={22} />
              </span>
              <div>
                <strong>前往講師工作台</strong>
                <p>查看已由平台審核並指派給你的課程與匿名滿意度。</p>
              </div>
              <LearnerPortalIcon name="chevron" size={20} />
            </Link>
          )}

          {!ownerMode &&
            !canShowCompleted &&
            !(data.isInstructor && canShowTeaching) && (
              <div className="professional-profile-empty public">
                <LearnerPortalIcon name="certificate" size={34} />
                <p>這位學員目前沒有公開課程成果。</p>
              </div>
            )}
        </section>
      </div>
    </div>
  );
}
