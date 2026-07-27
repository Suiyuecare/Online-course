import type { SupabaseClient } from "@supabase/supabase-js";
import {
  certificateRevocationWorkspaceSchema,
  surveyInvestigationWorkspaceSchema,
  type CertificateRevocationWorkspace,
  type SurveyInvestigationWorkspace,
} from "@/domain/quality-staff";

export async function readCertificateRevocationWorkspace(
  client: SupabaseClient,
  input: { search?: string; limit?: number } = {},
): Promise<CertificateRevocationWorkspace> {
  const { data, error } = await client.rpc(
    "read_certificate_revocation_workspace",
    {
      p_search: input.search?.trim() || null,
      p_limit: input.limit ?? 50,
    },
  );
  if (error) {
    throw new Error("CERTIFICATE_REVOCATION_WORKSPACE_UNAVAILABLE");
  }
  const parsed = certificateRevocationWorkspaceSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("CERTIFICATE_REVOCATION_WORKSPACE_INVALID");
  }
  return parsed.data;
}

export async function readSurveyInvestigationWorkspace(
  client: SupabaseClient,
  input: { search?: string; cursor?: string; limit?: number } = {},
): Promise<SurveyInvestigationWorkspace> {
  const { data, error } = await client.rpc(
    "read_survey_investigation_workspace",
    {
      p_search: input.search?.trim() || null,
      p_cursor: input.cursor?.trim() || null,
      p_limit: input.limit ?? 50,
    },
  );
  if (error) {
    throw new Error("SURVEY_INVESTIGATION_WORKSPACE_UNAVAILABLE");
  }
  const parsed = surveyInvestigationWorkspaceSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("SURVEY_INVESTIGATION_WORKSPACE_INVALID");
  }
  return parsed.data;
}
