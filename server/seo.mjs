import { HttpError } from './http.mjs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
export const sitemapIndex = origin => header + `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['pages','blogs','resumes'].map(name=>`<sitemap><loc>${escape(origin)}/sitemaps/${name}.xml</loc></sitemap>`).join('')}</sitemapindex>\n`;
export const sitemapUrls = urls => header + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(({loc,lastmod})=>`<url><loc>${escape(loc)}</loc>${lastmod?`<lastmod>${escape(lastmod)}</lastmod>`:''}</url>`).join('')}</urlset>\n`;
export const robotsText = origin => `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /r/\n\nSitemap: ${origin}/sitemap.xml\n`;

export function createSeo({db,origin,now=Date.now}) {
  db.exec('CREATE TABLE IF NOT EXISTS seo_changes (area TEXT PRIMARY KEY, changed_at TEXT NOT NULL) STRICT');
  const stamp = area => db.prepare('SELECT changed_at FROM seo_changes WHERE area=?').get(area)?.changed_at;
  const newest = (...values) => values.filter(Boolean).sort().at(-1);
  return {
    touch(area) { db.prepare('INSERT INTO seo_changes VALUES (?,?) ON CONFLICT(area) DO UPDATE SET changed_at=excluded.changed_at').run(area,new Date(now()).toISOString()); },
    publicRoute(req,res,url) {
      if (!['/robots.txt','/sitemap.xml','/sitemaps/pages.xml','/sitemaps/blogs.xml','/sitemaps/resumes.xml','/blog/sitemap.xml'].includes(url.pathname)) return false;
      if (!['GET','HEAD'].includes(req.method)) throw new HttpError(405,'Method not allowed.');
      let body;
      if (url.pathname==='/robots.txt') body=robotsText(origin);
      else if (url.pathname==='/sitemap.xml') body=sitemapIndex(origin);
      else if (url.pathname==='/sitemaps/pages.xml') {
        const blogModified=db.prepare('SELECT MAX(live_updated_at) AS value FROM blog_posts WHERE published_json IS NOT NULL').get().value;
        const count=Number(db.prepare('SELECT COUNT(*) AS total FROM blog_posts WHERE published_json IS NOT NULL').get().total);
        body=sitemapUrls([{loc:origin+'/',lastmod:stamp('home')},...Array.from({length:Math.max(1,Math.ceil(count/5))},(_,index)=>({loc:origin+'/blog'+(index?'?page='+(index+1):''),lastmod:newest(stamp('blogs'),blogModified)}))]);
      } else if (url.pathname==='/sitemaps/resumes.xml') {
        const resume=db.prepare('SELECT compiled_at FROM resumes WHERE id=(SELECT default_resume_id FROM resume_settings WHERE id=1)').get();
        body=sitemapUrls(resume?[{loc:origin+'/resume.pdf',lastmod:newest(resume.compiled_at,stamp('resume'))}]:[]);
      } else {
        const posts=db.prepare('SELECT published_slug,live_updated_at FROM blog_posts WHERE published_json IS NOT NULL ORDER BY published_at DESC,id DESC').all();
        const urls=posts.map(post=>({loc:origin+'/blog/'+post.published_slug,lastmod:post.live_updated_at}));
        // Preserve the previously advertised sitemap URL for existing crawlers.
        if(url.pathname==='/blog/sitemap.xml')urls.unshift({loc:origin+'/blog'});
        body=sitemapUrls(urls);
      }
      res.removeHeader('X-Robots-Tag');
      res.writeHead(200,{'Content-Type':url.pathname==='/robots.txt'?'text/plain; charset=utf-8':'application/xml; charset=utf-8','Content-Length':Buffer.byteLength(body)});
      res.end(req.method==='HEAD'?undefined:body);return true;
    },
  };
}
