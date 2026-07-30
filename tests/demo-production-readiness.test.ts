import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("customer demo release path", () => {
  it("keeps public visitors on login-free demo routes", () => {
    const home = source("src/app/page.tsx");
    const header = source("src/components/site-header.tsx");
    const footer = source("src/components/site-footer.tsx");
    const demo = source("src/app/demo/page.tsx");
    const login = source("src/components/phone-login.tsx");

    expect(home).toContain('href="/demo"');
    expect(home).toContain("封閉展示中");
    expect(home).toContain("目前尚未開放報名");
    expect(home).toContain("不會收取匯款或建立正式學習紀錄");
    expect(home).toContain("正式啟用後");
    expect(home).toContain("預計錄播每 10 分鐘確認在席");
    expect(home).not.toContain("開始找長照積分課程");
    expect(header).toContain('className="nav-demo" href="/demo"');
    expect(header).toContain("<PublicCartLink />");
    expect(footer).toContain('<Link href="/demo">功能操作導覽</Link>');
    expect(login).toContain("開始免登入功能導覽");
    expect(login).toContain('href="/demo"');
    expect(login).not.toContain("驗證服務尚未設定，登入功能目前安全關閉。");

    expect(demo).toContain('secondaryHref: "/courses"');
    expect(demo).toContain('secondaryHref: "/organization"');
    expect(demo).toContain('secondaryHref: "/legal"');
    expect(demo).not.toContain('secondaryHref: "/learner/catalog"');
    expect(demo).not.toContain('secondaryHref: "/staff"');
  });

  it("publishes complete discovery metadata and a localized recovery page", () => {
    const layout = source("src/app/layout.tsx");
    const robots = source("src/app/robots.ts");
    const sitemap = source("src/app/sitemap.ts");
    const notFound = source("src/app/not-found.tsx");

    expect(layout).toContain('url: "/suiyue-milk.png"');
    expect(layout).toContain("長照積分課程封閉展示");
    expect(layout).toContain("目前尚未開放報名或付款");
    expect(layout).not.toContain(
      "手機就能完成的錄播、同步直播與混合型長照積分課程。",
    );
    expect(robots).toContain('"/api/"');
    expect(robots).toContain("sitemap.xml");
    expect(sitemap).toContain("`${siteUrl}/courses`");
    expect(sitemap).toContain("`${siteUrl}/support`");
    expect(notFound).toContain("這一頁暫時找不到");
    expect(notFound).toContain('href="/courses"');
    expect(notFound).toContain('href="/demo"');
  });

  it("does not render missing legal and bank fields as broken placeholders", () => {
    const legal = source("src/app/legal/page.tsx");
    const support = source("src/app/support/page.tsx");
    const organizationDemo = source(
      "src/app/demo/organization/organization-demo.tsx",
    );

    expect(legal).toContain("目前為功能展示階段，尚未開放匯款或建立正式訂單");
    expect(legal).toContain("disclosedOperatingFields");
    expect(legal).not.toContain("尚未完成正式設定");
    expect(support).toContain("publicSupportDefaults");
    expect(organizationDemo).toContain("publicSupportDefaults.phone");
    expect(organizationDemo).not.toContain("7751-9076");
  });

  it("makes organization purchase and staff dual-review flows demonstrable", () => {
    const organizationDemo = source(
      "src/app/demo/organization/organization-demo.tsx",
    );
    const staffDemo = source("src/app/demo/staff/staff-demo.tsx");

    expect(organizationDemo).toContain("建立模擬匯款訂單");
    expect(organizationDemo).toContain("模擬回報已匯款");
    expect(organizationDemo).toContain("等待財務雙人覆核");
    expect(staffDemo).toContain("模擬第二人覆核");
    expect(staffDemo).toContain("人工判定原因（必填）");
    expect(staffDemo).toContain("原始事件與人工更正分開保存");
  });

  it("keeps the classroom demo usable when external video is blocked", () => {
    const runner = source("src/components/showcase-course-runner.tsx");

    expect(runner).toContain("切換離線展示");
    expect(runner).toContain("離線展示備援");
    expect(runner).toContain("不依賴外部影音");
    expect(runner).toContain("course.coverImage");
  });
});

describe("production worker and demo pulse", () => {
  it("supplements the daily Hobby rescue cron without weakening health gates", () => {
    const workflow = source(".github/workflows/production-pulse.yml");
    const vercel = source("vercel.json");
    const health = source("src/domain/runtime-health.ts");

    expect(workflow).toContain('cron: "7,17,27,37,47,57 * * * *"');
    expect(workflow).toContain("SUIYUE_PRODUCTION_CRON_SECRET");
    expect(workflow).toContain("/api/workers/wake");
    for (const route of [
      "/ /courses /demo /login /legal",
      "/demo/learner",
      "/demo/organization",
      "/demo/staff",
      "/courses/demo/dementia-compassionate-care/classroom",
      "/api/health",
    ]) {
      expect(workflow).toContain(route);
    }
    expect(workflow).toContain(
      ".dependencies.database == true and .dependencies.queue == true",
    );
    expect(vercel).toContain('"schedule": "0 16 * * *"');
    expect(health).toContain("const workerFreshnessMs = 20 * 60 * 1000");
  });
});
