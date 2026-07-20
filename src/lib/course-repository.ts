import "server-only";
import type { Course } from "@/lib/data";
import { pilotCourse } from "@/lib/data";
import {
  createSupabaseAdminClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

type DbCourse = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  status: string;
  delivery: "recorded" | "live";
  price_twd: number;
  accredited: boolean;
  accreditation_status: string;
  accreditation_number: string | null;
  accreditation_points: number;
  accreditation_authority: string | null;
  pass_score: number;
  completion_percent: number;
  organizer_name: string | null;
};
type DbLesson = {
  id: string;
  title: string;
  duration_seconds: number;
  is_preview: boolean;
  position: number;
  module_id: string;
};
type DbModule = { id: string; title: string; position: number };

function formatDuration(seconds: number) {
  if (seconds < 3600) return `${Math.max(1, Math.ceil(seconds / 60))} 分鐘`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return minutes ? `${hours} 小時 ${minutes} 分鐘` : `${hours} 小時`;
}
function formatClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export async function mapDatabaseCourse(course: DbCourse): Promise<Course> {
  const admin = createSupabaseAdminClient();
  if (!admin) return pilotCourse;
  const { data: liveSessions } =
    course.delivery === "live"
      ? await admin
          .from("live_sessions")
          .select(
            "id,title,instructor_name,starts_at,ends_at,capacity,status,live_session_bookings(status)",
          )
          .eq("course_id", course.id)
          .in("status", ["open", "scheduled"])
          .order("starts_at")
      : { data: [] };
  const { data: modules } = await admin
    .from("course_modules")
    .select("id,title,position")
    .eq("course_id", course.id)
    .order("position");
  const moduleIds = (modules ?? []).map((module) => module.id);
  const { data: lessons } = moduleIds.length
    ? await admin
        .from("lessons")
        .select("id,title,duration_seconds,is_preview,position,module_id")
        .in("module_id", moduleIds)
        .order("position")
    : { data: [] };
  const typedModules = (modules ?? []) as DbModule[];
  const typedLessons = (lessons ?? []) as DbLesson[];
  const orderedLessons = typedModules.flatMap((module) =>
    typedLessons
      .filter((lesson) => lesson.module_id === module.id)
      .sort((a, b) => a.position - b.position),
  );
  const firstSession = liveSessions?.[0];
  const liveDuration = firstSession
    ? Math.max(
        0,
        Math.round(
          (Date.parse(firstSession.ends_at) -
            Date.parse(firstSession.starts_at)) /
            1000,
        ),
      )
    : 0;
  const durationSeconds =
    course.delivery === "live"
      ? liveDuration
      : orderedLessons.reduce(
          (sum, lesson) => sum + lesson.duration_seconds,
          0,
        );
  return {
    id: course.id,
    delivery: course.delivery,
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle ?? "",
    category: course.accredited ? "長照積分課" : "專業照護",
    instructor:
      course.delivery === "live"
        ? (firstSession?.instructor_name ?? course.organizer_name ?? "歲悅講師")
        : (course.organizer_name ?? "歲悅照護團隊"),
    instructorRole:
      course.delivery === "live"
        ? "同步直播課程"
        : course.accredited
          ? "正式錄播積分課程"
          : "歲悅學苑講師團隊",
    price: course.price_twd,
    duration: durationSeconds ? formatDuration(durationSeconds) : "依場次",
    durationSeconds,
    lessons:
      course.delivery === "live"
        ? (liveSessions?.length ?? 0)
        : orderedLessons.length,
    credits: Number(course.accreditation_points ?? 0),
    level: "不限",
    color: course.accredited ? "cream" : "orange",
    icon: course.accredited ? "shield" : "heart",
    accredited: course.accredited,
    accreditationStatus: course.accreditation_status,
    accreditationNumber: course.accreditation_number,
    accreditationPoints: Number(course.accreditation_points ?? 0),
    accreditationAuthority: course.accreditation_authority,
    passScore: course.pass_score,
    completionPercent: course.completion_percent,
    status: "published",
    description: course.description ?? course.subtitle ?? "",
    outcomes: [],
    chapters: orderedLessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      duration: formatClock(lesson.duration_seconds),
      durationSeconds: lesson.duration_seconds,
      preview: lesson.is_preview,
    })),
    liveSessions: (liveSessions ?? []).map((session) => ({
      id: session.id,
      title: session.title,
      instructorName: session.instructor_name,
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      capacity: session.capacity,
      sold:
        session.live_session_bookings?.filter(
          (item) => item.status === "confirmed",
        ).length ?? 0,
      status: session.status,
    })),
  };
}

export async function getPublicCourses() {
  if (!isSupabaseConfigured()) return [pilotCourse];
  const admin = createSupabaseAdminClient();
  if (!admin) return [pilotCourse];
  const { data } = await admin
    .from("courses")
    .select(
      "id,slug,title,subtitle,description,delivery,status,price_twd,accredited,accreditation_status,accreditation_number,accreditation_points,accreditation_authority,pass_score,completion_percent,organizer_name",
    )
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (!data?.length) return [];
  return Promise.all((data as DbCourse[]).map(mapDatabaseCourse));
}

export async function getPublicCourse(slug: string) {
  if (!isSupabaseConfigured())
    return slug === pilotCourse.slug ? pilotCourse : null;
  const admin = createSupabaseAdminClient();
  if (!admin) return slug === pilotCourse.slug ? pilotCourse : null;
  const { data } = await admin
    .from("courses")
    .select(
      "id,slug,title,subtitle,description,delivery,status,price_twd,accredited,accreditation_status,accreditation_number,accreditation_points,accreditation_authority,pass_score,completion_percent,organizer_name",
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!data) return null;
  return mapDatabaseCourse(data as DbCourse);
}

export async function getLearningCourse(
  slug: string,
  learnerId: string,
  liveSessionId?: string,
) {
  if (!isSupabaseConfigured())
    return slug === pilotCourse.slug ? pilotCourse : null;
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("courses")
    .select(
      "id,slug,title,subtitle,description,delivery,status,price_twd,accredited,accreditation_status,accreditation_number,accreditation_points,accreditation_authority,pass_score,completion_percent,organizer_name",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;
  const course = data as DbCourse;
  if ((course.delivery === "live") !== Boolean(liveSessionId)) return null;
  let enrollmentQuery = admin
    .from("enrollments")
    .select("id")
    .eq("learner_id", learnerId)
    .eq("course_id", course.id)
    .in("status", ["active", "completed"]);
  enrollmentQuery = liveSessionId
    ? enrollmentQuery.eq("live_session_id", liveSessionId)
    : enrollmentQuery.is("live_session_id", null);
  const { data: enrollment } = await enrollmentQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return enrollment ? mapDatabaseCourse(course) : null;
}
