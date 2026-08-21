import Link from "next/link";
import Image from "next/image";
import type { CatalogCourse } from "@/infrastructure/supabase/catalog";
import { safeGoogleFormUrl } from "@/domain/education-quality";
import {
  AddOfficialCourseToCart,
  AddPublicCourseToCart,
  ToggleOfficialCourseFavorite,
} from "@/components/learner-course-actions";

const deliveryLabels = {
  recorded: "錄播",
  live: "同步直播",
  hybrid: "錄播＋直播",
};

export function CourseCard({
  course,
  learnerMode = false,
}: {
  course: CatalogCourse;
  learnerMode?: boolean;
}) {
  const purchaseReady = course.purchase_readiness?.purchaseReady === true;
  const usesExternalRegistration = course.registration_mode === "google_form";
  const registrationUrl = usesExternalRegistration
    ? safeGoogleFormUrl(course.external_registration_url)
    : null;

  return (
    <article className="course-card">
      <div className="course-visual" aria-hidden="true">
        {course.has_cover && (
          <Image
            alt=""
            fill
            sizes="(max-width: 760px) 100vw, 33vw"
            src={`/api/catalog/courses/${course.course_version_id}/cover`}
            unoptimized
          />
        )}
        <div>
          <span>{deliveryLabels[course.delivery_type]}</span>
          <i>長照積分課程</i>
        </div>
      </div>
      <div className="course-body">
        {course.registration_mode === "internal" &&
          course.accreditation_status === "applying" && (
            <p className="warning">積分申請中、尚未核定，不保證取得點數</p>
          )}
        <p className="eyebrow">
          {course.category_title}・{deliveryLabels[course.delivery_type]}
        </p>
        <h3>{course.title}</h3>
        <p>{course.summary}</p>
        <div className="course-meta">
          {course.registration_mode === "google_form" ? (
            <>
              <strong>外部報名</strong>
              <span>由主辦單位通知</span>
            </>
          ) : (
            <>
              <strong>NT$ {course.price_twd.toLocaleString("zh-TW")}</strong>
              <span>
                {course.accreditation_points
                  ? `${course.accreditation_points} 積分`
                  : "積分依核定結果"}
              </span>
            </>
          )}
        </div>
        <div className="learner-course-card-actions">
          <Link className="button secondary" href={`/courses/${course.slug}`}>
            查看課程
          </Link>
          {registrationUrl && (
            <a
              className="button"
              href={registrationUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {course.registration_cta_label}
            </a>
          )}
          {usesExternalRegistration && !registrationUrl && (
            <span className="closed-note">報名連結暫時無法使用</span>
          )}
          {learnerMode && (
            <>
              <ToggleOfficialCourseFavorite course={course} />
              {purchaseReady && course.registration_mode === "internal" && (
                <AddOfficialCourseToCart course={course} />
              )}
            </>
          )}
          {!learnerMode &&
            purchaseReady &&
            course.registration_mode === "internal" && (
              <AddPublicCourseToCart course={course} />
            )}
        </div>
      </div>
    </article>
  );
}
