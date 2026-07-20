"use client";

import { Printer } from "lucide-react";
export function PrintCertificateButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="button-primary print:hidden"
    >
      <Printer className="size-4" />
      列印或另存 PDF
    </button>
  );
}
