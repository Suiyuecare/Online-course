export type AccountReadState<T> =
  | { available: true; data: T }
  | { available: false; data: null };

export async function captureAccountRead<T>(
  read: PromiseLike<T>,
): Promise<AccountReadState<T>> {
  try {
    return { available: true, data: await read };
  } catch {
    return { available: false, data: null };
  }
}

export function accountCountDetail(
  count: number | null,
  labels: {
    empty: string;
    available: (count: number) => string;
    unavailable?: string;
  },
) {
  if (count === null) return labels.unavailable ?? "暫時無法讀取";
  if (count === 0) return labels.empty;
  return labels.available(count);
}
