import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("public and learner accessibility foundation", () => {
  it("offers a working skip link and a discoverable accessibility statement", () => {
    const layout = source("src/app/layout.tsx");
    const frame = source("src/components/site-frame.tsx");
    const learnerShell = source("src/components/learner-portal-shell.tsx");
    const footer = source("src/components/site-footer.tsx");
    const page = source("src/app/accessibility/page.tsx");

    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain("跳到主要內容");
    expect(frame).toContain('id="main-content"');
    expect(learnerShell).toContain('id="main-content"');
    expect(footer).toContain('href="/accessibility"');
    expect(page).toContain("放大文字與高對比");
    expect(page).toContain("鍵盤與焦點操作");
    expect(page).toContain("字幕、逐字稿與教材替代格式");
  });

  it("lets learners choose three device-local reading aids", () => {
    const panel = source("src/components/learner-preference-panel.tsx");
    const styles = source("src/app/globals.css");

    expect(panel).toContain("放大介面文字");
    expect(panel).toContain("減少動畫效果");
    expect(panel).toContain("提高文字與邊界對比");
    expect(panel).toContain("learner-pref-high-contrast");
    expect(styles).toContain(".learner-pref-high-contrast");
    expect(styles).toContain(".skip-link:focus");
  });
});
