import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const staffRole = z.enum([
  "instructor",
  "course_admin",
  "accreditation_reviewer",
  "finance",
  "support",
  "platform_admin",
]);

export const staffRoleCandidateSchema = z
  .object({
    personId: z.string().uuid(),
    displayName: z.string().min(1),
    maskedPhone: z.string().min(1),
    maskedEmail: z.string().nullable(),
    currentRoles: z.array(staffRole),
    pendingRoles: z.array(staffRole),
    registeredAt: z.string(),
  })
  .strict();

export type StaffRoleCandidate = z.infer<typeof staffRoleCandidateSchema>;
export type StaffRole = z.infer<typeof staffRole>;

export async function readStaffRoleCandidates(
  client: SupabaseClient,
  input: { search?: string; limit?: number } = {},
) {
  const { data, error } = await client.rpc("read_staff_role_candidates", {
    p_search: input.search?.trim() || null,
    p_limit: input.limit ?? 25,
  });
  if (error) throw new Error("STAFF_ROLE_DIRECTORY_UNAVAILABLE");
  const parsed = z.array(staffRoleCandidateSchema).safeParse(data);
  if (!parsed.success) throw new Error("STAFF_ROLE_DIRECTORY_INVALID");
  return parsed.data;
}
