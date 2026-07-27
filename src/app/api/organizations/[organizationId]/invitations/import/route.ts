import { Workbook, type CellValue } from "exceljs";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import {
  normalizeTaiwanMobile,
  prepareOrganizationInvitation,
} from "@/infrastructure/security/organization-invitations";
import { resolveActivePerson } from "@/infrastructure/security/accreditation-identity";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const allowedHeaders = ["手機", "姓名", "員工編號", "部門", "角色"] as const;

function cellText(value: CellValue) {
  if (
    value &&
    typeof value === "object" &&
    ("formula" in value || "sharedFormula" in value)
  ) {
    throw new Error("FORMULA_CELL_REJECTED");
  }
  return String(value ?? "").trim();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  return mutation(request, async () => {
    const { organizationId } = await context.params;
    z.uuid().parse(organizationId);
    const { uploadId } = await readJson(
      request,
      z.object({ uploadId: z.uuid() }),
    );
    const idempotencyKey = requireIdempotencyKey(request);
    const { supabase } = await requireUser();
    const personId = await resolveActivePerson(supabase);
    const { data: actorRole, error: authorizationError } = await supabase.rpc(
      "authorize_organization_invitation_preparation",
      {
        p_organization_id: organizationId,
        p_requested_role: null,
      },
    );
    if (
      authorizationError ||
      !["owner", "training_manager"].includes(String(actorRole))
    ) {
      throw new Error("ORGANIZATION_MANAGER_REQUIRED");
    }
    const service = serviceSupabase();
    const { data: safe, error: safeError } = await service.rpc(
      "read_safe_quarantine_upload",
      {
        p_upload_id: uploadId,
        p_owner_id: personId,
        p_purpose: "organization_roster",
      },
    );
    const safeUpload = z
      .object({
        objectPath: z.string(),
        contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
        detectedMime: z.string(),
      })
      .safeParse(safe);
    if (safeError || !safeUpload.success) {
      throw new Error("SAFE_ORGANIZATION_ROSTER_REQUIRED");
    }
    if (
      safeUpload.data.detectedMime !==
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      throw new Error("XLSX_ROSTER_REQUIRED");
    }
    const { data: object, error: objectError } = await service.storage
      .from("safe-uploads")
      .download(safeUpload.data.objectPath);
    if (objectError) throw new Error("ROSTER_OBJECT_UNAVAILABLE");
    const workbook = new Workbook();
    await workbook.xlsx.load(await object.arrayBuffer());
    if (workbook.worksheets.length !== 1) {
      throw new Error("ONE_ROSTER_WORKSHEET_REQUIRED");
    }
    const worksheet = workbook.worksheets[0]!;
    if (worksheet.rowCount < 2 || worksheet.rowCount > 1001) {
      throw new Error("ROSTER_ROW_LIMIT_REJECTED");
    }
    const headers = new Map<string, number>();
    worksheet.getRow(1).eachCell((cell, column) => {
      headers.set(cellText(cell.value), column);
    });
    if (!headers.has("手機")) throw new Error("ROSTER_PHONE_HEADER_REQUIRED");
    if (
      [...headers.keys()].some(
        (header) =>
          header !== "" &&
          !allowedHeaders.includes(header as (typeof allowedHeaders)[number]),
      )
    ) {
      throw new Error("ROSTER_UNKNOWN_HEADER");
    }
    const errors: Array<{ row: number; message: string }> = [];
    const parsed: Array<{
      phone: string;
      employeeName: string;
      employeeNumber: string;
      department: string;
      role: "training_manager" | "finance" | "member";
    }> = [];
    const seen = new Set<string>();
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      try {
        const read = (header: string) =>
          headers.has(header)
            ? cellText(row.getCell(headers.get(header)!).value)
            : "";
        const phone = normalizeTaiwanMobile(read("手機"));
        const roleValue = read("角色") || "member";
        const role = z
          .enum(["training_manager", "finance", "member"])
          .parse(roleValue);
        const optional = [read("姓名"), read("員工編號"), read("部門")];
        if (
          optional.some((value) => value.length > 100 || /^[=+\-@]/.test(value))
        ) {
          throw new Error("UNSAFE_OR_TOO_LONG_OPTIONAL_FIELD");
        }
        if (seen.has(phone)) throw new Error("DUPLICATE_PHONE");
        seen.add(phone);
        parsed.push({
          phone,
          employeeName: optional[0]!,
          employeeNumber: optional[1]!,
          department: optional[2]!,
          role,
        });
      } catch (caught) {
        errors.push({
          row: rowNumber,
          message: caught instanceof Error ? caught.message : "INVALID_ROW",
        });
      }
    }
    if (errors.length > 0) {
      return { imported: false, errors };
    }
    if (
      actorRole === "training_manager" &&
      parsed.some((row) => row.role !== "member")
    ) {
      throw new Error("ORGANIZATION_ROSTER_ROLE_REJECTED");
    }
    const preparedRows = [];
    for (const row of parsed) {
      const prepared = await prepareOrganizationInvitation({
        organizationId,
        phone: row.phone,
      });
      preparedRows.push({
        phoneCiphertext: prepared.phoneCiphertext,
        phoneBlindIndex: prepared.phoneBlindIndex,
        tokenHash: prepared.tokenHash,
        role: row.role,
        employeeName: row.employeeName,
        employeeNumber: row.employeeNumber,
        department: row.department,
      });
    }
    const { data, error } = await supabase.rpc(
      "import_organization_invitations",
      {
        p_organization_id: organizationId,
        p_upload_id: uploadId,
        p_rows: preparedRows,
        p_idempotency_key: idempotencyKey,
      },
    );
    if (error || !data) throw new Error("ROSTER_IMPORT_REJECTED");
    return { imported: true, ...data };
  });
}
