import type { SupabaseClient } from "@supabase/supabase-js";
import {
  educationQualityWorkspaceSchema,
  type EducationQualityWorkspace,
} from "@/domain/education-quality";

export async function readEducationQualityWorkspace(
  client: SupabaseClient,
): Promise<EducationQualityWorkspace> {
  const { data, error } = await client.rpc("read_education_quality_workspace");
  if (error) {
    throw new Error("EDUCATION_QUALITY_WORKSPACE_UNAVAILABLE");
  }

  const parsed = educationQualityWorkspaceSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("EDUCATION_QUALITY_WORKSPACE_INVALID");
  }
  return parsed.data;
}
