export type SensitiveStaffAction =
  | "course_publish"
  | "identity_decide"
  | "refund_decide"
  | "attendance_decide"
  | "export_generate_download"
  | "prerequisite_decide"
  | "bank_reconcile"
  | "invoice_result"
  | "refund_disburse"
  | "refund_disbursement_confirm"
  | "role_change_request"
  | "role_change_decide"
  | "point_refund_decide"
  | "point_refund_result"
  | "provider_anomaly_propose"
  | "provider_anomaly_decide"
  | "zoom_setup_reconcile_propose"
  | "zoom_setup_reconcile_decide";

const STEP_UP_ACTIONS: Record<SensitiveStaffAction, string> = {
  course_publish: "course_publish",
  identity_decide: "pii_decrypt",
  refund_decide: "refund_decision",
  attendance_decide: "attendance_override",
  export_generate_download: "accreditation_export",
  prerequisite_decide: "platform_prerequisite_review",
  bank_reconcile: "bank_reconciliation",
  invoice_result: "invoice_decision",
  refund_disburse: "refund_disbursement",
  refund_disbursement_confirm: "refund_disbursement",
  role_change_request: "role_change",
  role_change_decide: "role_change",
  point_refund_decide: "point_refund_decision",
  point_refund_result: "point_refund_result",
  provider_anomaly_propose: "attendance_override",
  provider_anomaly_decide: "attendance_override",
  zoom_setup_reconcile_propose: "provider_reconcile",
  zoom_setup_reconcile_decide: "provider_reconcile",
};

export function stepUpActionForStaffAction(action: SensitiveStaffAction) {
  return STEP_UP_ACTIONS[action];
}
