export const PILOT_COURSE_SLUG = "dementia-care-pilot";
export const PILOT_COURSE_ID = "d1111111-1111-4111-8111-111111111111";
export const PILOT_LESSON_ID = "d3333333-3333-4333-8333-333333333333";

export function presenceIntervalSeconds() {
  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV);
  if (isProduction) return 15 * 60;
  const configured = Number(process.env.PRESENCE_INTERVAL_SECONDS ?? 120);
  return Number.isFinite(configured)
    ? Math.max(60, Math.min(15 * 60, Math.floor(configured)))
    : 120;
}

export function appOrigin(request?: Request) {
  if (process.env.NEXT_PUBLIC_SITE_URL)
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (request) return new URL(request.url).origin;
  return "http://localhost:3000";
}
