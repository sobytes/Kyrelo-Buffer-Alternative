import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: "https://kyrelo.com",
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
