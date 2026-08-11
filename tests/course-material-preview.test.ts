import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { supportsInlineCourseMaterialPreview } from "@/components/course-material-download-button";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("protected course material preview", () => {
  it("allows only PDF and web-safe images inline", () => {
    expect(supportsInlineCourseMaterialPreview("application/pdf")).toBe(true);
    expect(supportsInlineCourseMaterialPreview("image/jpeg")).toBe(true);
    expect(supportsInlineCourseMaterialPreview("image/png")).toBe(true);
    expect(
      supportsInlineCourseMaterialPreview(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(false);
    expect(supportsInlineCourseMaterialPreview("text/csv")).toBe(false);
    expect(supportsInlineCourseMaterialPreview("text/html")).toBe(false);
  });

  it("uses the authorized, integrity-checked endpoint for both actions", () => {
    const component = source(
      "src/components/course-material-download-button.tsx",
    );
    const endpoint = source(
      "src/app/api/learner/materials/[courseMaterialId]/download/route.ts",
    );

    expect(component).toContain(
      "/api/learner/materials/${encodeURIComponent(materialId)}/download",
    );
    expect(component).toContain('method: "POST"');
    expect(component).toContain('cache: "no-store"');
    expect(component).not.toContain("supabase.co");
    expect(endpoint).toContain('"read_learner_course_material_reference"');
    expect(endpoint).toContain("resolveActivePerson");
    expect(endpoint).toContain('createHash("sha256")');
    expect(endpoint).toContain("COURSE_MATERIAL_INTEGRITY_FAILED");
    expect(endpoint).toContain('"cache-control": "no-store"');
  });

  it("keeps previews temporary and downloads available", () => {
    const component = source(
      "src/components/course-material-download-button.tsx",
    );

    expect(component).toContain("URL.createObjectURL");
    expect(component).toContain("URL.revokeObjectURL(previewObjectUrl)");
    expect(component).toContain("activeRequestRef.current?.abort()");
    expect(component).toContain("anchor.download = resource.fileName");
    expect(component).toContain('sandbox=""');
    expect(component).toContain("title={`預覽教材「${title}」`}");
    expect(component).toContain("aria-busy={busyAction !== null}");
    expect(component).toContain("這份教材是試算表或 CSV");
  });

  it("mounts the preview in the formal material activity with minimal CSP", () => {
    const runner = source("src/components/learner-course-runner.tsx");
    const config = source("next.config.ts");

    expect(runner).toContain("allowInlinePreview");
    expect(runner).toContain("PDF、JPG 與 PNG 可在教室內預覽");
    expect(runner).toContain("XLSX 與 CSV");
    expect(runner).not.toContain("下一版可在此區");
    expect(config).toContain(
      "\"frame-src 'self' blob: https://challenges.cloudflare.com",
    );
  });
});
