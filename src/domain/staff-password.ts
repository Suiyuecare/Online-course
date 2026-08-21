import { z } from "zod";

export const staffPasswordSchema = z
  .string()
  .min(14)
  .max(128)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/)
  .regex(/[^A-Za-z0-9]/)
  .refine((value) => !/\s/.test(value));

export const completeStaffPasswordSchema = z.object({
  password: staffPasswordSchema,
});

export function isProtectedStaffMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return metadata?.account_type === "staff" && metadata.staff_login === true;
}

export function mustChangeStaffPassword(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return (
    isProtectedStaffMetadata(metadata) &&
    metadata?.must_change_password === true
  );
}
