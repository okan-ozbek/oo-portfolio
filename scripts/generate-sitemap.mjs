import { writeFile } from "node:fs/promises";

export async function generateSitemap(outputDirectory) {
  // This portfolio has one indexable page. Section anchors are not separate URLs.
  // Add canonical page URLs here when the site gains additional pages.
  const urls = ["https://pixelware.nl/"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url><loc>${url}</loc></url>`).join("\n")}
</urlset>
`;
  // Omit lastmod rather than falsely marking every rebuild as a content update.
  await writeFile(new URL("sitemap.xml", outputDirectory), xml, "utf8");
}
