export function safeInternalPath(
  value: string | null | undefined,
  fallback = "/dashboard",
) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return fallback;
  try {
    const trustedOrigin = "https://suiyue.internal";
    const target = new URL(value, trustedOrigin);
    if (target.origin !== trustedOrigin) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
