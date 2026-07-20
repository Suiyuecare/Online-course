import { notFound } from "next/navigation";
import { QuizFlow } from "@/components/quiz-flow";
import {
  getLearningCourse,
  getPublicCourse,
} from "@/lib/course-repository";
import { getAuthenticatedUserId } from "@/lib/supabase/server";

export default async function QuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseSlug: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const courseSlug = (await params).courseSlug;
  const liveSessionId = (await searchParams).session;
  const userId = await getAuthenticatedUserId();
  const course =
    (userId
      ? await getLearningCourse(courseSlug, userId, liveSessionId)
      : null) ?? (await getPublicCourse(courseSlug));
  if (!course) notFound();
  return <QuizFlow course={course} liveSessionId={liveSessionId} />;
}
