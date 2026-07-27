import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShowcaseCourseDetail } from "@/components/showcase-course-detail";
import { showcaseCourse, showcaseCourses } from "@/content/showcase-courses";

export function generateStaticParams() {
  return showcaseCourses.map((course) => ({ slug: course.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const course = showcaseCourse(slug);
  if (!course) return {};
  return {
    title: `${course.title}｜網站功能示範`,
    description: `${course.summary} 本頁為網站功能示範，尚未開放報名，也不是已核定的正式積分課程。`,
    robots: {
      index: false,
      follow: false,
      noarchive: true,
    },
  };
}

export default async function ShowcaseCoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = showcaseCourse(slug);
  if (!course) notFound();
  return <ShowcaseCourseDetail course={course} />;
}
