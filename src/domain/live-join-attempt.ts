export type LiveJoinAttemptTerminalEvent =
  | "abort_accepted"
  | "check_out_accepted"
  | "lease_expired";

export type BrowserStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export function persistedLiveJoinAttemptId(
  storage: BrowserStorage,
  storageKey: string,
  createId: () => string,
): string {
  const stored = storage.getItem(storageKey);
  if (stored && /^[0-9a-f-]{36}$/i.test(stored)) return stored;
  const created = createId();
  storage.setItem(storageKey, created);
  return created;
}

export function clearTerminalLiveJoinAttempt(
  storage: BrowserStorage,
  storageKeys: readonly string[],
  event: LiveJoinAttemptTerminalEvent,
): void {
  switch (event) {
    case "abort_accepted":
    case "check_out_accepted":
    case "lease_expired":
      for (const storageKey of storageKeys) storage.removeItem(storageKey);
  }
}
