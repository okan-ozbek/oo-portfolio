import { mkdir, writeFile } from "node:fs/promises";
import { sitemapIndex, sitemapUrls } from '../server/seo.mjs';

export async function generateSitemap(outputDirectory) {
  // Static preview fallbacks. Production and development serve live SQLite data.
  const origin='https://pixelware.nl';
  await mkdir(new URL('sitemaps/',outputDirectory),{recursive:true});
  await writeFile(new URL('sitemap.xml',outputDirectory),sitemapIndex(origin),'utf8');
  await writeFile(new URL('sitemaps/pages.xml',outputDirectory),sitemapUrls([{loc:origin+'/'},{loc:origin+'/blog'}]),'utf8');
  for(const name of ['blogs','resumes'])await writeFile(new URL(`sitemaps/${name}.xml`,outputDirectory),sitemapUrls([]),'utf8');
}
