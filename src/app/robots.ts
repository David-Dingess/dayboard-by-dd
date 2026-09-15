import type { MetadataRoute } from "next";

// A private calendar. Nothing here is ever for a crawler.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
