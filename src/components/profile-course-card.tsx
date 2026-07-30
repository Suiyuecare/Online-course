import Image from "next/image";
import Link from "next/link";
import type { ProfileCourse } from "@/application/professional-profile";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";

const deliveryLabel = {
  recorded: "預錄課",
  live: "同步直播",
  hybrid: "錄播＋直播",
};

function formatCompletedAt(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

export function ProfileCourseCard({ course }: { course: ProfileCourse }) {
  const content = (
    <>
      <div className="profile-course-cover">
        {course.hasCover ? (
          <Image
            alt=""
            fill
            sizes="(max-width: 760px) 100vw, 320px"
            src={`/api/catalog/courses/${course.courseVersionId}/cover`}
            unoptimized
          />
        ) : (
          <span aria-hidden="true">
            <LearnerPortalIcon name="book" size={34} />
          </span>
        )}
        <small>{deliveryLabel[course.deliveryType]}</small>
      </div>
      <div className="profile-course-copy">
        <span>{course.statusLabel}</span>
        <h3>{course.title}</h3>
        {course.completedAt ? (
          <p>{formatCompletedAt(course.completedAt)} 完成</p>
        ) : (
          <p>歲悅學苑專業課程</p>
        )}
      </div>
    </>
  );

  return course.slug ? (
    <Link className="profile-course-card" href={`/courses/${course.slug}`}>
      {content}
    </Link>
  ) : (
    <article className="profile-course-card">{content}</article>
  );
}
