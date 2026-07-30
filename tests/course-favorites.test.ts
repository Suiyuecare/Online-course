import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260728145659_learner_course_favorites.sql",
);

describe("account-backed course favorites", () => {
  it("binds favorites to stable courses and owner-only reads", () => {
    expect(migration).toContain("create table public.course_favorites");
    expect(migration).toContain("primary key (person_id, course_id)");
    expect(migration).toContain(
      "references public.people(id) on delete cascade",
    );
    expect(migration).toContain(
      "references public.courses(id) on delete cascade",
    );
    expect(migration).toContain(
      "alter table public.course_favorites force row level security",
    );
    expect(migration).toContain("course_favorites_owner_read");
    expect(migration).toContain(
      "using (person_id = (select internal.request_person_id()))",
    );
  });

  it("does not grant browser roles direct favorite mutation", () => {
    expect(migration).toContain("revoke all on table public.course_favorites");
    expect(migration).toContain(
      "grant select on table public.course_favorites to authenticated",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[\s\S]*?course_favorites[\s\S]*?authenticated/i,
    );
  });

  it("derives the actor and permits only currently cataloged additions", () => {
    expect(migration).toContain("actor uuid := internal.current_person_id()");
    expect(migration).toContain("public.published_course_catalog");
    expect(migration).toContain("COURSE_NOT_FAVORITABLE");
    expect(migration).toContain(
      "on conflict (person_id, course_id) do nothing",
    );
    expect(migration).not.toContain("submitted_person");
  });

  it("exposes an invoker-only RPC and keeps the internal definer hidden", () => {
    expect(migration).toContain(
      "create or replace function public.set_own_course_favorite",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain(
      "revoke all on function internal.set_own_course_favorite(text, boolean)",
    );
    const publicFunction =
      migration.match(
        /create or replace function public\.set_own_course_favorite[\s\S]*?\n\$\$;/,
      )?.[0] ?? "";
    expect(publicFunction).toContain("security invoker");
    expect(publicFunction).not.toContain("security definer");
  });

  it("shows service failures separately from an empty collection", () => {
    const page = source("src/components/learner-favorites-view.tsx");
    expect(page).toContain("暫時無法讀取你的收藏");
    expect(page).toContain("這不是「沒有收藏」");
    expect(page).toContain("還沒有收藏任何課程");
    expect(page).toContain("同步直播");
    expect(page).toContain("錄播＋直播");
  });

  it("keeps the favorite row visible when its course leaves the catalog", () => {
    const application = source("src/application/course-favorites.ts");
    const page = source("src/components/learner-favorites-view.tsx");

    expect(application).toContain(
      '.select("course_id,created_at,courses(slug)")',
    );
    expect(application).not.toContain("courses!inner(slug)");
    expect(application).toContain("slug: string | null");
    expect(page).toContain("currentUnavailableFavorites");
    expect(page).toContain("重新開放後會自動恢復課程資訊");
  });
});
