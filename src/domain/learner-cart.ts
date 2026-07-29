import { z } from "zod";

export const learnerCartMaximumItems = 100;
export const anonymousLearnerCartStorageKey =
  "suiyue:learner-cart:anonymous:v2";

const deliveryTypeSchema = z.enum(["recorded", "live", "hybrid"]);

export const learnerCartItemSchema = z
  .object({
    courseVersionId: z.uuid(),
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(160),
    priceTwd: z.number().int().nonnegative().max(10_000_000),
    deliveryType: deliveryTypeSchema,
    hasCover: z.boolean(),
    available: z.boolean(),
    addedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const learnerCartResponseSchema = z
  .object({
    items: z.array(learnerCartItemSchema).max(learnerCartMaximumItems),
    rejectedCourseVersionIds: z.array(z.uuid()).max(learnerCartMaximumItems),
  })
  .strict();

export const learnerCartMutationSchema = z
  .object({
    operation: z.enum(["merge", "add", "remove"]),
    courseVersionIds: z.array(z.uuid()).max(learnerCartMaximumItems),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation !== "merge" && value.courseVersionIds.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "LEARNER_CART_INVALID",
        path: ["courseVersionIds"],
      });
    }
  });

export type LearnerCartItem = z.infer<typeof learnerCartItemSchema>;
export type LearnerCartResponse = z.infer<typeof learnerCartResponseSchema>;
export type LearnerCartMutation = z.infer<typeof learnerCartMutationSchema>;

const localCartItemSchema = z
  .object({
    courseVersionId: z.uuid(),
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(160),
    priceTwd: z.number().int().nonnegative().max(10_000_000),
    deliveryType: deliveryTypeSchema,
    hasCover: z.boolean().optional(),
    coverUrl: z
      .string()
      .regex(/^\/api\/catalog\/courses\/[0-9a-f-]{36}\/cover$/i)
      .nullable()
      .optional(),
    available: z.boolean().optional(),
    addedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .passthrough();

export function learnerCartCacheStorageKey(accountId: string) {
  return `suiyue:learner-cart:${accountId}:v2`;
}

export function legacyLearnerPortalStorageKey(accountId: string) {
  return `suiyue:learner-portal:${accountId}:v1`;
}

export function parseLearnerCartStorage(
  value: string | null,
): LearnerCartItem[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return [];
    const candidate = parsed as { cart?: unknown };
    if (!Array.isArray(candidate.cart)) return [];
    return candidate.cart
      .slice(0, learnerCartMaximumItems)
      .flatMap((item, index) => {
        const result = localCartItemSchema.safeParse(item);
        if (!result.success) return [];
        return [
          {
            courseVersionId: result.data.courseVersionId,
            slug: result.data.slug,
            title: result.data.title,
            priceTwd: result.data.priceTwd,
            deliveryType: result.data.deliveryType,
            hasCover:
              result.data.hasCover ?? typeof result.data.coverUrl === "string",
            available: result.data.available ?? true,
            addedAt: result.data.addedAt ?? new Date(index).toISOString(),
          },
        ];
      });
  } catch {
    return [];
  }
}

export function mergeLearnerCartItems(
  ...sources: LearnerCartItem[][]
): LearnerCartItem[] {
  return deduplicateLearnerCartItems(...sources).slice(
    0,
    learnerCartMaximumItems,
  );
}

export function deduplicateLearnerCartItems(
  ...sources: LearnerCartItem[][]
): LearnerCartItem[] {
  const merged = new Map<string, LearnerCartItem>();
  for (const source of sources) {
    for (const item of source) {
      if (!merged.has(item.courseVersionId)) {
        merged.set(item.courseVersionId, item);
      }
    }
  }
  return [...merged.values()];
}

export function serializeLearnerCartStorage(items: LearnerCartItem[]) {
  return JSON.stringify({
    cart: items.slice(0, learnerCartMaximumItems),
  });
}
