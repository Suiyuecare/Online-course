import { createHmac } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { serverConfig } from "@/infrastructure/config";
import { resolveActivePerson } from "@/infrastructure/security/accreditation-identity";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const rowSchema = z.object({
  remitterName: z.string().trim().min(1).max(100),
  accountLastFive: z
    .string()
    .regex(/^\d{5}$/)
    .nullable(),
  amountTwd: z.number().int().positive(),
  bankReference: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      z.object({
        quarantineId: z.uuid(),
        bookedOn: z.iso.date(),
        rows: z.array(rowSchema).min(1).max(5000),
      }),
    );
    const secret = serverConfig().BANK_IMPORT_HMAC_SECRET;
    if (!secret) throw new Error("BANK_IMPORT_CONFIGURATION_MISSING");
    const { supabase } = await requireUser();
    const personId = await resolveActivePerson(supabase);
    const { data, error } = await serviceSupabase().rpc(
      "read_safe_quarantine_upload",
      {
        p_upload_id: input.quarantineId,
        p_owner_id: personId,
        p_purpose: "bank_statement",
      },
    );
    const source = z
      .object({
        objectPath: z.string().min(1),
        contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .safeParse(data);
    if (error || !source.success) throw new Error("SAFE_BANK_SOURCE_REQUIRED");
    const rows = input.rows.map((row, index) => ({
      ...row,
      fingerprint: createHmac("sha256", secret)
        .update(
          [
            source.data.contentSha256,
            index,
            input.bookedOn,
            row.remitterName,
            row.accountLastFive ?? "",
            row.amountTwd,
            row.bankReference,
          ].join("|"),
        )
        .digest("hex"),
    }));
    const { data: batchId, error: importError } = await supabase.rpc(
      "import_bank_statement_batch",
      {
        p_source_sha256: source.data.contentSha256,
        p_attachment_reference: source.data.objectPath,
        p_booked_on: input.bookedOn,
        p_bank_total_twd: rows.reduce((total, row) => total + row.amountTwd, 0),
        p_rows: rows,
      },
    );
    if (importError || !batchId) throw new Error("BANK_IMPORT_REJECTED");
    return { batchId, requiresDistinctReconciliation: true };
  });
}
