import { safeInternalPath } from "./safe-redirect";

export function authCallbackDestinations(rawNext: string | null) {
  const success = safeInternalPath(rawNext);
  const query = new URLSearchParams({
    error: "auth_callback",
    next: success,
  });

  return {
    success,
    failure: `/login?${query.toString()}`,
  };
}
