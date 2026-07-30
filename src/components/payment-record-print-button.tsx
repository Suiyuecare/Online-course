"use client";

export function PaymentRecordPrintButton() {
  return (
    <button
      className="button payment-record-print-button"
      onClick={() => window.print()}
      type="button"
    >
      列印／另存 PDF
    </button>
  );
}
