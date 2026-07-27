import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicConfig } from "@/infrastructure/config";

export type CatalogCourse = {
  slug: string;
  course_version_id: string;
  title: string;
  summary: string;
  description: string;
  learning_objectives: string[];
  delivery_type: "recorded" | "live" | "hybrid";
  price_twd: number;
  recorded_refund_allocation_twd: number;
  live_refund_allocations: {
    componentId: string;
    title: string;
    amountTwd: number;
  }[];
  organization_point_price: number | null;
  accreditation_status: "applying" | "approved";
  accreditation_points: number | null;
  has_cover: boolean;
  equipment_requirements: string;
  instructors: {
    name: string;
    biography: string;
    credentials: string;
  }[];
  first_live_starts_at: string | null;
  legal_document_id: string;
  legal_document_sha256: string;
  live_sessions: {
    id: string;
    componentId: string | null;
    title: string;
    startsAt: string;
    endsAt: string;
    bookingCloseAt: string;
  }[];
};

export async function catalogCourses(): Promise<CatalogCourse[]> {
  const config = publicConfig();
  if (
    !config.NEXT_PUBLIC_SUPABASE_URL ||
    !config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return [];
  }
  const client = createClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const { data, error } = await client
      .from("published_course_catalog")
      .select(
        "slug,course_version_id,title,summary,description,learning_objectives,delivery_type,price_twd,recorded_refund_allocation_twd,live_refund_allocations,organization_point_price,accreditation_status,accreditation_points,has_cover,equipment_requirements,instructors,first_live_starts_at,legal_document_id,legal_document_sha256,live_sessions",
      )
      .order("title")
      .abortSignal(controller.signal);
    if (error) return [];
    return ((data ?? []) as CatalogCourse[]).filter(
      catalogRefundAllocationIsValid,
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function catalogRefundAllocationIsValid(course: CatalogCourse) {
  if (
    !Number.isInteger(course.price_twd) ||
    course.price_twd < 0 ||
    !Number.isInteger(course.recorded_refund_allocation_twd) ||
    course.recorded_refund_allocation_twd < 0 ||
    !Array.isArray(course.live_refund_allocations) ||
    course.live_refund_allocations.some(
      (item) =>
        !Number.isInteger(item.amountTwd) ||
        item.amountTwd < 0 ||
        typeof item.title !== "string" ||
        !item.title.trim(),
    )
  ) {
    return false;
  }
  const liveTotal = course.live_refund_allocations.reduce(
    (sum, item) => sum + item.amountTwd,
    0,
  );
  if (course.recorded_refund_allocation_twd + liveTotal !== course.price_twd) {
    return false;
  }
  return course.delivery_type === "recorded"
    ? course.live_refund_allocations.length === 0 &&
        liveTotal === 0 &&
        course.recorded_refund_allocation_twd === course.price_twd
    : course.delivery_type === "live"
      ? course.recorded_refund_allocation_twd === 0 &&
        course.live_refund_allocations.length === 1
      : course.live_refund_allocations.length > 0;
}

export async function catalogCourse(slug: string) {
  return (
    (await catalogCourses()).find((course) => course.slug === slug) ?? null
  );
}

export type CoursePurchaseReadiness = {
  purchaseReady: boolean;
  reasons: string[];
};

const courseOutlineSchema = z
  .object({
    modules: z.array(
      z
        .object({
          id: z.uuid(),
          title: z.string().min(1),
          durationSeconds: z.number().int().nonnegative(),
          lessons: z.array(
            z
              .object({
                id: z.uuid().nullable(),
                title: z.string().min(1),
                type: z.enum(["video", "material", "quiz", "survey"]),
                durationSeconds: z.number().int().positive().nullable(),
                preview: z.boolean(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export type CourseOutline = z.infer<typeof courseOutlineSchema>;

export async function courseOutline(
  courseVersionId: string,
): Promise<CourseOutline> {
  const config = publicConfig();
  if (
    !config.NEXT_PUBLIC_SUPABASE_URL ||
    !config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return { modules: [] };
  }
  const client = createClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const { data, error } = await client
      .rpc("read_public_course_outline", {
        p_course_version_id: courseVersionId,
      })
      .abortSignal(controller.signal);
    if (error) return { modules: [] };
    const parsed = courseOutlineSchema.safeParse(data);
    return parsed.success ? parsed.data : { modules: [] };
  } catch {
    return { modules: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export async function coursePurchaseReadiness(
  courseVersionId: string,
): Promise<CoursePurchaseReadiness> {
  const config = publicConfig();
  if (
    !config.NEXT_PUBLIC_SUPABASE_URL ||
    !config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return {
      purchaseReady: false,
      reasons: ["報名服務尚未完成設定。"],
    };
  }
  const client = createClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const { data, error } = await client
      .rpc("read_public_course_readiness", {
        p_course_version_id: courseVersionId,
      })
      .abortSignal(controller.signal);
    if (error || !data || typeof data !== "object") {
      throw new Error("READINESS_UNAVAILABLE");
    }
    const candidate = data as Record<string, unknown>;
    if (
      typeof candidate.purchaseReady !== "boolean" ||
      !Array.isArray(candidate.reasons) ||
      !candidate.reasons.every((reason) => typeof reason === "string")
    ) {
      throw new Error("READINESS_INVALID");
    }
    return {
      purchaseReady: candidate.purchaseReady,
      reasons: candidate.reasons,
    };
  } catch {
    return {
      purchaseReady: false,
      reasons: ["系統目前無法完成報名安全檢查，暫不接受新訂單。"],
    };
  } finally {
    clearTimeout(timeout);
  }
}
