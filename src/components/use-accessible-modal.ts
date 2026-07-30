"use client";

import { useEffect, useRef, type RefObject } from "react";

const modalFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

export type AccessibleModalKeyboardAction =
  | "close"
  | "focus-dialog"
  | "focus-first"
  | "focus-last"
  | "none";

export function getAccessibleModalKeyboardAction({
  activeIndex,
  focusableCount,
  key,
  shiftKey,
}: {
  activeIndex: number;
  focusableCount: number;
  key: string;
  shiftKey: boolean;
}): AccessibleModalKeyboardAction {
  if (key === "Escape") return "close";
  if (key !== "Tab") return "none";
  if (focusableCount === 0) return "focus-dialog";
  if (shiftKey && activeIndex <= 0) return "focus-last";
  if (!shiftKey && (activeIndex < 0 || activeIndex >= focusableCount - 1)) {
    return "focus-first";
  }
  return "none";
}

export function useAccessibleModal(
  open: boolean,
  onClose: () => void,
): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableItems = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(modalFocusableSelector),
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true",
      );

    const initialFocus =
      dialog.querySelector<HTMLElement>("[data-modal-initial-focus]") ??
      focusableItems()[0] ??
      dialog;
    initialFocus.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      const items = focusableItems();
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      const action = getAccessibleModalKeyboardAction({
        activeIndex,
        focusableCount: items.length,
        key: event.key,
        shiftKey: event.shiftKey,
      });

      if (action === "none") return;

      event.preventDefault();
      event.stopPropagation();

      if (action === "close") {
        onCloseRef.current();
      } else if (action === "focus-dialog") {
        dialog.focus();
      } else if (action === "focus-first") {
        items[0]?.focus();
      } else {
        items.at(-1)?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  return dialogRef;
}
