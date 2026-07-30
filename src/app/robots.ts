import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://class.suiyuecare.com";

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/courses", "/support", "/legal", "/accessibility"],
      disallow: [
        "/api/",
        "/admin/",
        "/demo/",
        "/learner/",
        "/login",
        "/organization/",
        "/staff/",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
