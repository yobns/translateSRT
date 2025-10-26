import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = (globalThis as any)?.process?.env?.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const host = new URL(siteUrl).host;
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host,
  };
}
