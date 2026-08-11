import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://class.suiyuecare.com";
  const lastModified = new Date();

  return [
    {
      url: siteUrl,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/courses`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/support`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/legal`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${siteUrl}/accessibility`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
