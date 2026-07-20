import { notFound, redirect } from "next/navigation";
import { LearningPlayer } from "@/components/learning-player";
import {
  getLearningCourse,
  getPublicCourse,
} from "@/lib/course-repository";
import { presenceIntervalSeconds } from "@/lib/env";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ preview?: string; lesson?: string }>;
}) {
  const { courseId } = await params;
  const query = await searchParams;
  const configured = isSupabaseConfigured();
  const publicCourse = await getPublicCourse(courseId);
  if (!configured) {
    if (!publicCourse) notFound();
    const fallbackLessonId = publicCourse.chapters[0]?.id ?? "";
    return (
      <LearningPlayer
        key={fallbackLessonId}
        course={publicCourse}
        lessonId={fallbackLessonId}
        access={false}
        preview={query.preview === "1"}
        presenceInterval={presenceIntervalSeconds()}
      />
    );
  }
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    if (!publicCourse) notFound();
    redirect(
      `/login?next=${encodeURIComponent(`/learn/${publicCourse.slug}${query.lesson ? `?lesson=${query.lesson}` : ""}`)}`,
    );
  }
  const course = (await getLearningCourse(courseId, userId)) ?? publicCourse;
  if (!course) notFound();
  const fallbackLessonId = course.chapters[0]?.id ?? "";
  const admin = createSupabaseAdminClient();
  if (!admin || !course.id)
    return (
      <LearningPlayer
        course={course}
        lessonId={fallbackLessonId}
        access={false}
        presenceInterval={presenceIntervalSeconds()}
      />
    );
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id,last_lesson_id,status")
    .eq("learner_id", userId)
    .eq("course_id", course.id)
    .in("status", ["active", "completed"])
    .is("live_session_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const requestedId = query.lesson;
  const selectedId =
    requestedId && course.chapters.some((item) => item.id === requestedId)
      ? requestedId
      : enrollment?.last_lesson_id &&
          course.chapters.some((item) => item.id === enrollment.last_lesson_id)
        ? enrollment.last_lesson_id
        : fallbackLessonId;
  const [{ data: lesson }, { data: lessonProgress }] = await Promise.all([
    selectedId
      ? admin
          .from("lessons")
          .select("id,stream_uid,video_status")
          .eq("id", selectedId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    enrollment && selectedId
      ? admin
          .from("lesson_progress")
          .select("last_position_seconds")
          .eq("enrollment_id", enrollment.id)
          .eq("lesson_id", selectedId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return (
    <LearningPlayer
      key={lesson?.id ?? selectedId}
      course={course}
      lessonId={lesson?.id ?? selectedId}
      access={Boolean(
        enrollment && lesson?.stream_uid && lesson.video_status === "ready",
      )}
      resumePosition={lessonProgress?.last_position_seconds ?? 0}
      presenceInterval={presenceIntervalSeconds()}
    />
  );
}
