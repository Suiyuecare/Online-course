import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { LearnerCenterRow } from "@/application/learner-center";
import type { InstructorDashboard } from "@/application/workspace";

const profileRowSchema = z.object({
  person_id: z.string().uuid(),
  public_slug: z.string(),
  public_name: z.string(),
  headline: z.string(),
  website_url: z.string().nullable(),
  biography: z.string(),
  expertise: z.array(z.string()),
  interests: z.array(z.string()),
  avatar_upload_id: z.string().uuid().nullable(),
  cover_upload_id: z.string().uuid().nullable(),
  is_public: z.boolean(),
  show_about: z.boolean(),
  show_completed_courses: z.boolean(),
  show_teaching_courses: z.boolean(),
  version: z.number().int().positive(),
  moderation_hidden_at: z.string().nullable(),
  moderation_reason: z.string().nullable(),
  updated_at: z.string(),
});

export const professionalProfileSchema = z.object({
  slug: z.string().nullable(),
  publicName: z.string(),
  headline: z.string(),
  websiteUrl: z.string().nullable(),
  biography: z.string(),
  expertise: z.array(z.string()),
  interests: z.array(z.string()),
  hasAvatar: z.boolean(),
  hasCover: z.boolean(),
  isPublic: z.boolean(),
  showAbout: z.boolean(),
  showCompletedCourses: z.boolean(),
  showTeachingCourses: z.boolean(),
  version: z.number().int().nonnegative(),
  moderationHidden: z.boolean(),
  moderationReason: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export type ProfessionalProfile = z.infer<typeof professionalProfileSchema>;

export const profileCourseSchema = z.object({
  courseVersionId: z.string().uuid(),
  slug: z.string().nullable(),
  title: z.string(),
  deliveryType: z.enum(["recorded", "live", "hybrid"]),
  hasCover: z.boolean(),
  completedAt: z.string().nullable(),
  hasCertificate: z.boolean(),
  statusLabel: z.string(),
});

export type ProfileCourse = z.infer<typeof profileCourseSchema>;

export type ProfessionalProfilePageData = {
  profile: ProfessionalProfile;
  completedCourses: ProfileCourse[];
  teachingCourses: ProfileCourse[];
  completedCount: number;
  certificateCount: number;
  teachingCount: number;
  isInstructor: boolean;
};

const profileSelect =
  "person_id,public_slug,public_name,headline,website_url,biography,expertise,interests,avatar_upload_id,cover_upload_id,is_public,show_about,show_completed_courses,show_teaching_courses,version,moderation_hidden_at,moderation_reason,updated_at";

function mapProfile(
  row: z.infer<typeof profileRowSchema>,
): ProfessionalProfile {
  return {
    slug: row.public_slug,
    publicName: row.public_name,
    headline: row.headline,
    websiteUrl: row.website_url,
    biography: row.biography,
    expertise: row.expertise,
    interests: row.interests,
    hasAvatar: Boolean(row.avatar_upload_id),
    hasCover: Boolean(row.cover_upload_id),
    isPublic: row.is_public,
    showAbout: row.show_about,
    showCompletedCourses: row.show_completed_courses,
    showTeachingCourses: row.show_teaching_courses,
    version: row.version,
    moderationHidden: Boolean(row.moderation_hidden_at),
    moderationReason: row.moderation_reason,
    updatedAt: row.updated_at,
  };
}

export function emptyProfessionalProfile(
  publicName: string,
): ProfessionalProfile {
  return {
    slug: null,
    publicName,
    headline: "",
    websiteUrl: null,
    biography: "",
    expertise: [],
    interests: [],
    hasAvatar: false,
    hasCover: false,
    isPublic: false,
    showAbout: false,
    showCompletedCourses: false,
    showTeachingCourses: false,
    version: 0,
    moderationHidden: false,
    moderationReason: null,
    updatedAt: null,
  };
}

export async function readOwnProfessionalProfile(
  client: SupabaseClient,
  fallbackName: string,
) {
  const { data, error } = await client
    .from("professional_profiles")
    .select(profileSelect)
    .maybeSingle();
  if (error) throw new Error("PROFESSIONAL_PROFILE_UNAVAILABLE");
  if (!data) return emptyProfessionalProfile(fallbackName);
  const parsed = profileRowSchema.safeParse(data);
  if (!parsed.success) throw new Error("PROFESSIONAL_PROFILE_INVALID");
  return mapProfile(parsed.data);
}

function ownCompletedCourses(rows: LearnerCenterRow[]): ProfileCourse[] {
  return rows
    .filter((row) =>
      ["completed", "submitted", "credited"].includes(row.enrollment_status),
    )
    .map((row) => ({
      courseVersionId: row.course_version_id,
      slug: row.course_slug,
      title: row.course_title,
      deliveryType: row.delivery_type,
      hasCover: row.has_cover,
      completedAt: row.completed_at,
      hasCertificate: Boolean(row.certificate_id),
      statusLabel: row.certificate_id ? "已取得結訓證明" : "已完成",
    }));
}

function ownTeachingCourses(
  dashboard: InstructorDashboard | null,
): ProfileCourse[] {
  if (!dashboard) return [];
  return dashboard.courses.map((course) => ({
    courseVersionId: course.courseVersionId,
    slug: null,
    title: course.title,
    deliveryType: course.deliveryType,
    hasCover: false,
    completedAt: null,
    hasCertificate: false,
    statusLabel:
      course.status === "published" ? "授課中" : `課程狀態：${course.status}`,
  }));
}

export function buildOwnProfessionalProfilePageData({
  profile,
  learnerRows,
  instructorDashboard,
}: {
  profile: ProfessionalProfile;
  learnerRows: LearnerCenterRow[];
  instructorDashboard: InstructorDashboard | null;
}): ProfessionalProfilePageData {
  const completedCourses = ownCompletedCourses(learnerRows);
  const teachingCourses = ownTeachingCourses(instructorDashboard);
  return {
    profile,
    completedCourses,
    teachingCourses,
    completedCount: completedCourses.length,
    certificateCount: completedCourses.filter((course) => course.hasCertificate)
      .length,
    teachingCount: teachingCourses.length,
    isInstructor: Boolean(instructorDashboard),
  };
}

const enrollmentRowSchema = z.object({
  id: z.string().uuid(),
  course_version_id: z.string().uuid(),
  status: z.string(),
  completed_at: z.string().nullable(),
});

const courseVersionRowSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid(),
  title: z.string(),
  delivery_type: z.enum(["recorded", "live", "hybrid"]),
  status: z.string(),
  has_cover: z.boolean(),
});

async function publicCompletedCourses(
  client: SupabaseClient,
  personId: string,
): Promise<ProfileCourse[]> {
  const { data: enrollmentData, error: enrollmentError } = await client
    .from("enrollments")
    .select("id,course_version_id,status,completed_at")
    .eq("person_id", personId)
    .in("status", ["completed", "submitted", "credited"])
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(24);
  if (enrollmentError) throw new Error("PUBLIC_PROFILE_COURSES_UNAVAILABLE");
  const enrollments = z.array(enrollmentRowSchema).parse(enrollmentData ?? []);
  if (enrollments.length === 0) return [];
  const versionIds = [
    ...new Set(enrollments.map((row) => row.course_version_id)),
  ];
  const enrollmentIds = enrollments.map((row) => row.id);
  const [{ data: versionData, error: versionError }, certificateResult] =
    await Promise.all([
      client
        .from("course_versions")
        .select("id,course_id,title,delivery_type,status,has_cover")
        .in("id", versionIds)
        .eq("status", "published"),
      client
        .from("certificates")
        .select("enrollment_id,current_status")
        .in("enrollment_id", enrollmentIds)
        .in("current_status", ["active", "submitted", "credited"]),
    ]);
  if (versionError || certificateResult.error) {
    throw new Error("PUBLIC_PROFILE_COURSES_UNAVAILABLE");
  }
  const versions = z.array(courseVersionRowSchema).parse(versionData ?? []);
  const courseIds = [...new Set(versions.map((row) => row.course_id))];
  const { data: courseData, error: courseError } = courseIds.length
    ? await client.from("courses").select("id,slug").in("id", courseIds)
    : { data: [], error: null };
  if (courseError) throw new Error("PUBLIC_PROFILE_COURSES_UNAVAILABLE");
  const courseSlugs = new Map(
    z
      .array(z.object({ id: z.string().uuid(), slug: z.string() }))
      .parse(courseData ?? [])
      .map((course) => [course.id, course.slug]),
  );
  const certificates = new Set(
    z
      .array(
        z.object({
          enrollment_id: z.string().uuid(),
          current_status: z.string(),
        }),
      )
      .parse(certificateResult.data ?? [])
      .map((row) => row.enrollment_id),
  );
  const enrollmentByVersion = new Map(
    enrollments.map((row) => [row.course_version_id, row]),
  );
  return versions.map((version) => {
    const enrollment = enrollmentByVersion.get(version.id);
    return {
      courseVersionId: version.id,
      slug: courseSlugs.get(version.course_id) ?? null,
      title: version.title,
      deliveryType: version.delivery_type,
      hasCover: version.has_cover,
      completedAt: enrollment?.completed_at ?? null,
      hasCertificate: enrollment ? certificates.has(enrollment.id) : false,
      statusLabel:
        enrollment && certificates.has(enrollment.id)
          ? "已取得結訓證明"
          : "已完成",
    };
  });
}

async function publicTeachingCourses(
  client: SupabaseClient,
  personId: string,
): Promise<ProfileCourse[]> {
  const [{ data: role }, { data: instructor }] = await Promise.all([
    client
      .from("staff_roles")
      .select("id")
      .eq("person_id", personId)
      .eq("role", "instructor")
      .eq("active", true)
      .maybeSingle(),
    client
      .from("instructors")
      .select("id")
      .eq("person_id", personId)
      .eq("active", true)
      .maybeSingle(),
  ]);
  if (!role || !instructor) return [];
  const { data: bindingData, error: bindingError } = await client
    .from("course_instructors")
    .select("course_version_id")
    .eq("instructor_id", instructor.id);
  if (bindingError) throw new Error("PUBLIC_PROFILE_COURSES_UNAVAILABLE");
  const versionIds = z
    .array(z.object({ course_version_id: z.string().uuid() }))
    .parse(bindingData ?? [])
    .map((row) => row.course_version_id);
  if (versionIds.length === 0) return [];
  const { data: versionData, error: versionError } = await client
    .from("course_versions")
    .select("id,course_id,title,delivery_type,status,has_cover")
    .in("id", versionIds)
    .eq("status", "published");
  if (versionError) throw new Error("PUBLIC_PROFILE_COURSES_UNAVAILABLE");
  const versions = z.array(courseVersionRowSchema).parse(versionData ?? []);
  const courseIds = [...new Set(versions.map((row) => row.course_id))];
  const { data: courseData, error: courseError } = await client
    .from("courses")
    .select("id,slug")
    .in("id", courseIds);
  if (courseError) throw new Error("PUBLIC_PROFILE_COURSES_UNAVAILABLE");
  const courseSlugs = new Map(
    z
      .array(z.object({ id: z.string().uuid(), slug: z.string() }))
      .parse(courseData ?? [])
      .map((course) => [course.id, course.slug]),
  );
  return versions.map((version) => ({
    courseVersionId: version.id,
    slug: courseSlugs.get(version.course_id) ?? null,
    title: version.title,
    deliveryType: version.delivery_type,
    hasCover: version.has_cover,
    completedAt: null,
    hasCertificate: false,
    statusLabel: "授課中",
  }));
}

export async function readPublicProfessionalProfile(
  client: SupabaseClient,
  slug: string,
): Promise<ProfessionalProfilePageData | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const { data, error } = await client
    .from("professional_profiles")
    .select(profileSelect)
    .eq("public_slug", slug)
    .eq("is_public", true)
    .is("moderation_hidden_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = profileRowSchema.safeParse(data);
  if (!parsed.success) return null;
  const { data: person } = await client
    .from("people")
    .select("id")
    .eq("id", parsed.data.person_id)
    .is("anonymized_at", null)
    .maybeSingle();
  if (!person) return null;
  const [completedCourses, teachingCourses] = await Promise.all([
    parsed.data.show_completed_courses
      ? publicCompletedCourses(client, parsed.data.person_id)
      : Promise.resolve([]),
    parsed.data.show_teaching_courses
      ? publicTeachingCourses(client, parsed.data.person_id)
      : Promise.resolve([]),
  ]);
  return {
    profile: mapProfile(parsed.data),
    completedCourses,
    teachingCourses,
    completedCount: completedCourses.length,
    certificateCount: completedCourses.filter((course) => course.hasCertificate)
      .length,
    teachingCount: teachingCourses.length,
    isInstructor: teachingCourses.length > 0,
  };
}
