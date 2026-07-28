import Image from "next/image";
import Link from "next/link";
import type { ShowcaseCourse } from "@/content/showcase-courses";
import { ToggleShowcaseFavorite } from "@/components/learner-course-actions";

const deliveryLabels = {
  recorded: "錄播",
  live: "同步直播",
  hybrid: "錄播＋直播",
};

export function ShowcaseCourseCard({
  course,
  learnerMode = false,
}: {
  course: ShowcaseCourse;
  learnerMode?: boolean;
}) {
  return (
    <article className="course-card showcase-course-card">
      <Link
        aria-label={`查看${course.title}視覺示範`}
        className="course-visual showcase-course-visual"
        href={`/courses/demo/${course.slug}`}
      >
        <Image
          alt={course.coverAlt}
          fill
          sizes="(max-width: 760px) 100vw, (max-width: 1100px) 50vw, 33vw"
          src={course.coverImage}
        />
        <span className="showcase-label">網站功能示範</span>
        <div>
          <span>{deliveryLabels[course.deliveryType]}</span>
          <i>{course.category}</i>
        </div>
      </Link>
      <div className="course-body">
        <p className="eyebrow">{course.category}</p>
        <h3>
          <Link href={`/courses/demo/${course.slug}`}>{course.title}</Link>
        </h3>
        <p>{course.summary}</p>
        <ul className="course-facts" aria-label="課程資訊">
          <li>{course.durationMinutes} 分鐘</li>
          <li>{course.lessonCount} 個單元</li>
          <li>{course.creditType}</li>
        </ul>
        <div className="course-meta">
          <strong>
            NT$ {course.displayPriceTwd.toLocaleString("zh-TW")}
            <small> 示意</small>
          </strong>
          <span>尚未開放報名</span>
        </div>
        <div className="learner-course-card-actions">
          <Link
            className="button secondary"
            href={`/courses/demo/${course.slug}`}
          >
            看課程示範
          </Link>
          {learnerMode && <ToggleShowcaseFavorite course={course} />}
        </div>
      </div>
    </article>
  );
}
