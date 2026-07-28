import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShowcaseCourseRunner } from "@/components/showcase-course-runner";
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
    title: `${course.title}｜數位教室示範`,
    description:
      "歲悅學苑數位教室操作示範。本頁不保存進度、不計觀看分鐘，也不產生長照積分。",
    robots: {
      index: false,
      follow: false,
      noarchive: true,
    },
  };
}

export default async function ShowcaseClassroomPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ activity?: string }>;
}) {
  const { slug } = await params;
  const course = showcaseCourse(slug);
  if (!course) notFound();
  const { activity } = await searchParams;

  return <ShowcaseCourseRunner course={course} initialActivityId={activity} />;
}
