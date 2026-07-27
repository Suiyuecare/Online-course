import type { Metadata } from "next";
import { CourseCard } from "@/components/course-card";
import { catalogCourses } from "@/infrastructure/supabase/catalog";

export const metadata: Metadata = { title: "找課程" };

export default async function CoursesPage() {
  const courses = await catalogCourses();
  return (
    <section className="page-shell shell">
      <div className="section-heading">
        <p className="eyebrow">長照積分課程</p>
        <h1>選一門適合你的課</h1>
        <p>錄播、同步直播與混合課程，都在同一處查看。</p>
      </div>
      {courses.length ? (
        <div className="course-grid">
          {courses.map((course) => (
            <CourseCard course={course} key={course.slug} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>目前沒有可報名的課程</h2>
          <p>只有通過發布檢查、且仍在可售期間的課程才會顯示。</p>
        </div>
      )}
    </section>
  );
}
