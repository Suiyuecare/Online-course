import { z } from "zod";

export const courseRegistrationModeSchema = z.enum(["internal", "google_form"]);

/**
 * Accept only the two official Google Forms URL shapes used by this platform.
 * Returning null instead of throwing keeps the helper safe for public catalog
 * rendering as well as staff-side validation.
 */
export function safeGoogleFormUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    return null;
  }

  const shortFormPath = /^\/[A-Za-z0-9_-]+$/;
  const fullFormPath = /^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform$/;
  const pathAllowed =
    (url.hostname === "forms.gle" && shortFormPath.test(url.pathname)) ||
    (url.hostname === "docs.google.com" && fullFormPath.test(url.pathname));

  // Google share links may include tracking or prefill parameters. They are
  // intentionally discarded so staff cannot publish a URL containing
  // learner data (for example entry.* values) or an opaque redirect fragment.
  return pathAllowed ? `${url.origin}${url.pathname}` : null;
}

export const googleFormUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((value, context) => {
    const safeUrl = safeGoogleFormUrl(value);
    if (!safeUrl) {
      context.addIssue({
        code: "custom",
        message: "請使用有效的 Google 表單報名網址",
      });
      return z.NEVER;
    }
    return safeUrl;
  });

const registrationCtaLabelSchema = z.string().trim().min(2).max(20);

export const educationQualityRegistrationInputSchema = z.discriminatedUnion(
  "registrationMode",
  [
    z.strictObject({
      registrationMode: z.literal("internal"),
      externalRegistrationUrl: z.null(),
      registrationCtaLabel: registrationCtaLabelSchema,
    }),
    z.strictObject({
      registrationMode: z.literal("google_form"),
      externalRegistrationUrl: googleFormUrlSchema,
      registrationCtaLabel: registrationCtaLabelSchema,
    }),
  ],
);

export const educationQualityCourseStatusSchema = z.enum([
  "draft",
  "in_review",
  "published",
  "suspended",
]);

const educationQualityCourseBaseSchema = z.strictObject({
  courseVersionId: z.uuid(),
  slug: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(500),
  deliveryType: z.enum(["recorded", "live", "hybrid"]),
  status: educationQualityCourseStatusSchema,
  registrationCtaLabel: registrationCtaLabelSchema,
  hasCover: z.boolean(),
  canEdit: z.boolean(),
  canSubmit: z.boolean(),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const educationQualityCourseSchema = z.discriminatedUnion(
  "registrationMode",
  [
    educationQualityCourseBaseSchema.extend({
      registrationMode: z.literal("internal"),
      externalRegistrationUrl: z.null(),
    }),
    educationQualityCourseBaseSchema.extend({
      registrationMode: z.literal("google_form"),
      externalRegistrationUrl: googleFormUrlSchema,
    }),
  ],
);

export const educationQualityWorkspaceSchema = z.strictObject({
  courses: z.array(educationQualityCourseSchema),
});

export type EducationQualityCourse = z.infer<
  typeof educationQualityCourseSchema
>;
export type EducationQualityWorkspace = z.infer<
  typeof educationQualityWorkspaceSchema
>;

export const educationQualityStatusPresentation: Record<
  z.infer<typeof educationQualityCourseStatusSchema>,
  {
    label: string;
    description: string;
    tone: "neutral" | "warning" | "success";
  }
> = {
  draft: {
    label: "草稿，可編輯",
    description: "完成課程內容與報名設定後，即可送交執行長審核。",
    tone: "neutral",
  },
  in_review: {
    label: "等待執行長審核",
    description: "審核通過前不會出現在前台，也不會開放學員報名。",
    tone: "warning",
  },
  published: {
    label: "已核准上架",
    description: "課程已公開，學員可從前台查看並依設定報名。",
    tone: "success",
  },
  suspended: {
    label: "已暫停",
    description: "前台已停止接受新的報名，既有紀錄仍完整保留。",
    tone: "warning",
  },
};
