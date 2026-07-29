import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().min(2).max(500),
    code: z
      .string()
      .trim()
      .min(4)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/),
    benefitKind: z.enum(["percent_off", "fixed_twd"]),
    percentOffBps: z.number().int().min(100).max(9900).nullable(),
    fixedDiscountTwd: z.number().int().positive().nullable(),
    maxDiscountTwd: z.number().int().positive().nullable(),
    minimumSubtotalTwd: z.number().int().nonnegative(),
    validFrom: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
    totalClaimLimit: z.number().int().min(1).max(1_000_000),
    totalRedemptionLimit: z.number().int().min(1).max(1_000_000),
    courseVersionIds: z.array(z.uuid()).max(100),
  })
  .superRefine((value, context) => {
    if (Date.parse(value.validUntil) <= Date.parse(value.validFrom)) {
      context.addIssue({
        code: "custom",
        message: "COUPON_WINDOW_INVALID",
        path: ["validUntil"],
      });
    }
    if (value.totalRedemptionLimit > value.totalClaimLimit) {
      context.addIssue({
        code: "custom",
        message: "COUPON_LIMIT_INVALID",
        path: ["totalRedemptionLimit"],
      });
    }
    if (
      value.benefitKind === "percent_off" &&
      (value.percentOffBps === null || value.fixedDiscountTwd !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "COUPON_BENEFIT_INVALID",
        path: ["percentOffBps"],
      });
    }
    if (
      value.benefitKind === "fixed_twd" &&
      (value.fixedDiscountTwd === null ||
        value.percentOffBps !== null ||
        value.maxDiscountTwd !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "COUPON_BENEFIT_INVALID",
        path: ["fixedDiscountTwd"],
      });
    }
  });

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const input = await readJson(request, schema);
    return new PlatformApplication(supabase).createCouponCampaign({
      ...input,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
