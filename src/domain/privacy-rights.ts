import { z } from "zod";

export const privacyRequestOptions = [
  {
    value: "access",
    label: "查詢或取得我的資料",
    description: "了解平台保存哪些帳號、訂單、學習、積分與客服資料。",
  },
  {
    value: "correction",
    label: "更正無法自行修改的資料",
    description: "申請更正正式姓名、積分送審或其他受保護資料。",
  },
  {
    value: "restriction",
    label: "停止或限制特定資料利用",
    description: "說明希望停止的用途；必要保存與法定申報會另行說明。",
  },
  {
    value: "deletion",
    label: "停用帳號並申請刪除",
    description: "先凍結登入與新交易，再確認依法可刪除或必須保留的資料。",
  },
] as const;

export const privacyRequestTypeSchema = z.enum(
  privacyRequestOptions.map((option) => option.value) as [
    (typeof privacyRequestOptions)[number]["value"],
    ...(typeof privacyRequestOptions)[number]["value"][],
  ],
);

export const privacyRequestInputSchema = z
  .object({
    requestType: privacyRequestTypeSchema,
    detail: z.string().trim().min(10).max(2000),
    acknowledged: z.literal(true),
  })
  .strict();

export type PrivacyRequestType = z.infer<typeof privacyRequestTypeSchema>;

export function privacyRequestLabel(value: PrivacyRequestType) {
  return (
    privacyRequestOptions.find((option) => option.value === value)?.label ??
    "個資權利申請"
  );
}
