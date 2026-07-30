import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modalKeyboardAction } from "@/components/recorded-classroom";

const classroomSource = readFileSync(
  join(process.cwd(), "src", "components", "recorded-classroom.tsx"),
  "utf8",
);

describe("recorded classroom modal keyboard behavior", () => {
  it("blocks Escape for the timed presence challenge without treating it as confirmation", () => {
    expect(
      modalKeyboardAction({
        key: "Escape",
        shiftKey: false,
        activeIndex: 0,
        focusableCount: 1,
        escapeBehavior: "block",
      }),
    ).toEqual({ type: "block-escape" });
  });

  it("allows Escape to safely cancel device takeover before playback starts", () => {
    expect(
      modalKeyboardAction({
        key: "Escape",
        shiftKey: false,
        activeIndex: 0,
        focusableCount: 2,
        escapeBehavior: "dismiss",
      }),
    ).toEqual({ type: "dismiss" });
  });

  it("keeps Tab inside a one-action presence dialog", () => {
    expect(
      modalKeyboardAction({
        key: "Tab",
        shiftKey: false,
        activeIndex: 0,
        focusableCount: 1,
        escapeBehavior: "block",
      }),
    ).toEqual({ type: "focus-item", index: 0 });
    expect(
      modalKeyboardAction({
        key: "Tab",
        shiftKey: true,
        activeIndex: 0,
        focusableCount: 1,
        escapeBehavior: "block",
      }),
    ).toEqual({ type: "focus-item", index: 0 });
  });

  it("wraps focus at both boundaries of the takeover dialog", () => {
    expect(
      modalKeyboardAction({
        key: "Tab",
        shiftKey: false,
        activeIndex: 1,
        focusableCount: 2,
        escapeBehavior: "dismiss",
      }),
    ).toEqual({ type: "focus-item", index: 0 });
    expect(
      modalKeyboardAction({
        key: "Tab",
        shiftKey: true,
        activeIndex: 0,
        focusableCount: 2,
        escapeBehavior: "dismiss",
      }),
    ).toEqual({ type: "focus-item", index: 1 });
  });
});

describe("recorded classroom modal accessibility contract", () => {
  it("gives both dialogs an explicit accessible name, description, and initial focus", () => {
    expect(classroomSource).toContain("aria-labelledby={takeoverTitleId}");
    expect(classroomSource).toContain(
      "aria-describedby={takeoverDescriptionId}",
    );
    expect(classroomSource).toContain("ref={takeoverCancelButtonRef}");
    expect(classroomSource).toContain("aria-labelledby={presenceTitleId}");
    expect(classroomSource).toContain(
      "aria-describedby={presenceDescriptionId}",
    );
    expect(classroomSource).toContain("ref={presenceConfirmButtonRef}");
    expect(classroomSource).toContain('role="alertdialog"');
    expect(classroomSource).toContain('role="timer"');
  });

  it("uses the shared focus trap with distinct Escape policies", () => {
    expect(classroomSource).toContain(
      'document.addEventListener("keydown", handleKeyDown, true)',
    );
    expect(classroomSource).toContain(
      'document.removeEventListener("keydown", handleKeyDown, true)',
    );
    expect(classroomSource).toContain('escapeBehavior: "dismiss"');
    expect(classroomSource).toContain('escapeBehavior: "block"');
    expect(classroomSource).toContain("event.stopImmediatePropagation()");
    expect(classroomSource).toContain(
      "(initialFocusRef.current ?? dialog).focus()",
    );
  });

  it("makes playback and start controls inert while their modal is open", () => {
    expect(
      classroomSource.match(
        /inert=\{takeoverPromptOpen \? true : undefined\}/g,
      ),
    ).toHaveLength(3);
    expect(
      classroomSource.match(/inert=\{presencePromptOpen \? true : undefined\}/g)
        ?.length,
    ).toBeGreaterThanOrEqual(6);
    expect(classroomSource).toContain('aria-modal="true"');
  });
});
