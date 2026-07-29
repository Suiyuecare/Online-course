import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fillOrganizationBatchSelection,
  isOrganizationBatchSelectionValid,
  ORGANIZATION_BATCH_ASSIGNMENT_LIMIT,
  translateOrganizationBatchAssignmentError,
  updateOrganizationBatchMemberSelection,
} from "@/components/organization-batch-assignment";

const members = Array.from({ length: 250 }, (_, index) => ({
  personId: `member-${index + 1}`,
}));

describe("organization batch assignment selection limit", () => {
  it("never lets select-all exceed the fixed 200-person batch limit", () => {
    const selected = fillOrganizationBatchSelection([], members);

    expect(ORGANIZATION_BATCH_ASSIGNMENT_LIMIT).toBe(200);
    expect(selected).toHaveLength(200);
    expect(new Set(selected).size).toBe(200);
    expect(selected.at(0)).toBe("member-1");
    expect(selected.at(-1)).toBe("member-200");
  });

  it("preserves manually selected members before filling the remaining capacity", () => {
    const selected = fillOrganizationBatchSelection(
      ["member-249", "member-203", "member-249"],
      members,
    );

    expect(selected).toHaveLength(200);
    expect(selected.slice(0, 2)).toEqual(["member-249", "member-203"]);
    expect(selected).toContain("member-1");
    expect(new Set(selected).size).toBe(200);
  });

  it("blocks a new member at capacity but still allows a selected member to be removed", () => {
    const fullSelection = fillOrganizationBatchSelection([], members);

    expect(
      updateOrganizationBatchMemberSelection(
        fullSelection,
        members,
        "member-201",
        true,
      ),
    ).toEqual(fullSelection);

    const reducedSelection = updateOrganizationBatchMemberSelection(
      fullSelection,
      members,
      "member-1",
      false,
    );
    expect(reducedSelection).toHaveLength(199);
    expect(reducedSelection).not.toContain("member-1");
  });

  it("allows submission only for 1 through 200 unique members", () => {
    expect(isOrganizationBatchSelectionValid([])).toBe(false);
    expect(isOrganizationBatchSelectionValid(["member-1"])).toBe(true);
    expect(isOrganizationBatchSelectionValid(["member-1", "member-1"])).toBe(
      false,
    );
    expect(
      isOrganizationBatchSelectionValid(
        members
          .slice(0, ORGANIZATION_BATCH_ASSIGNMENT_LIMIT)
          .map((member) => member.personId),
      ),
    ).toBe(true);
    expect(
      isOrganizationBatchSelectionValid(
        members
          .slice(0, ORGANIZATION_BATCH_ASSIGNMENT_LIMIT + 1)
          .map((member) => member.personId),
      ),
    ).toBe(false);
  });

  it("translates API max-size errors into an actionable Taiwanese Chinese message", () => {
    for (const code of [
      "Too big",
      "ORGANIZATION_ASSIGNMENT_BATCH_LIMIT_EXCEEDED",
      "TOO_MANY_MEMBERS",
    ]) {
      expect(translateOrganizationBatchAssignmentError(code)).toBe(
        "單批最多只能指派 200 位員工，請保留 200 位以內後重新送出。",
      );
    }
  });
});

describe("organization batch assignment accessible capacity guidance", () => {
  it("describes the count, remaining capacity, overflow behavior and disabled controls", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/organization-batch-assignment.tsx"),
      "utf8",
    );

    for (const proof of [
      "已選 {selectedMemberIds.length}",
      "還可選",
      "會保留您已手動勾選的人",
      "其餘成員請另開一批",
      "aria-describedby={selectionCapacityHelpId}",
      "disabled={busy || capacityReached}",
      "disabled={!canSubmit}",
      'role="status"',
    ]) {
      expect(source).toContain(proof);
    }
  });
});
