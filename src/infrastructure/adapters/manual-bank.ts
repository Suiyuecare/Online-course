import { createHash } from "node:crypto";
import { z } from "zod";

const bankRow = z.object({
  bookedOn: z.iso.date(),
  amountTwd: z.number().int().positive(),
  remitterName: z.string().trim().min(1).max(100),
  accountLastFive: z.string().regex(/^\d{5}$/),
  bankReference: z.string().trim().min(1).max(200),
});

export type BankRow = z.infer<typeof bankRow>;

export class ManualBankAdapter {
  parseRow(value: unknown): BankRow {
    return bankRow.parse(value);
  }

  sourceHash(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  transactionFingerprint(row: BankRow): string {
    return createHash("sha256")
      .update(
        [
          row.bookedOn,
          row.amountTwd,
          row.remitterName.normalize("NFKC"),
          row.accountLastFive,
          row.bankReference,
        ].join("\u001f"),
      )
      .digest("hex");
  }
}
