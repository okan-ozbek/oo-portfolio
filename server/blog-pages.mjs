import { createHash } from 'node:crypto';
import { escapeHtml as e, renderMarkdown } from './blog-markdown.mjs';
import { artUrl, artHtml } from './blog-art.mjs';

export const blogCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self'; img-src 'self'; font-src 'self' https://fonts.gstatic.com; frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://codepen.io https://codesandbox.io https://stackblitz.com https://systems.pixelware.nl; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
// Escape HTML delimiters without HTML-encoding the JSON values themselves.
const jsonLd = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
export function blogPageCsp(html) {
  const data=/<script type="application\/ld\+json">([^]*?)<\/script>/.exec(html)?.[1];
  return data ? blogCsp.replace("script-src 'self'",`script-src 'self' 'sha256-${createHash('sha256').update(data).digest('base64')}'`) : blogCsp;
}
export function authorHtml(author) {
  const photo = author.avatarId ? `<img src="/blog/media/${e(author.avatarId)}?size=avatar" alt="" width="32" height="32">` : `<span class="blog-avatar" aria-hidden="true">${e(author.name.slice(0,1))}</span>`;
  return `<span class="blog-author">${photo}${author.linkedinUrl ? `<a href="${e(author.linkedinUrl)}" target="_blank" rel="noopener noreferrer">${e(author.name)}</a>` : `<span>${e(author.name)}</span>`}</span>`;
}
export function feedRow(post) {
  return `<article class="blog-feed-row"><a class="blog-feed-image" href="/blog/${e(post.slug)}" tabindex="-1" aria-hidden="true">${post.thumbnailPreset?artHtml({preset:post.thumbnailPreset,position:post.thumbnailPosition},post.id):`<img src="${e(post.thumbnailUrl)}" style="object-position:${e(post.thumbnailPosition ?? 'center')}" loading="lazy" alt="">`}</a><div class="blog-feed-copy"><h2><a href="/blog/${e(post.slug)}">${e(post.title)}${arrow}</a></h2><p class="blog-feed-summary">${e(post.summary)}</p><div class="blog-feed-meta">${authorHtml(post.author)}<time datetime="${e(post.publishedAt)}">${date(post.publishedAt)}</time></div></div></article>`;
}
const arrow = '<svg class="site-arrow" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10M7 17 17 7"/></svg>';
const date = value => new Intl.DateTimeFormat('en', { day:'numeric',month:'short',year:'numeric',timeZone:'UTC' }).format(new Date(value));
function shell({title,description='',canonical,body,image,origin,preview=false,structuredData}) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${e(title)} · Pixelware</title><meta name="description" content="${e(description)}">${preview?'<meta name="robots" content="noindex,nofollow">':`<link rel="canonical" href="${e(canonical)}"><meta property="og:url" content="${e(canonical)}">`}<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:type" content="article">${image?`<meta property="og:image" content="${e(new URL(image,origin).href)}"><meta name="twitter:card" content="summary_large_image">`:''}${structuredData?`<script type="application/ld+json">${jsonLd(structuredData)}</script>`:''}<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/blog/assets/blog.css"><script type="module" src="/blog/assets/reader.js"></script></head><body class="blog-reader"><header class="blog-site-header site-header site-frame"><a class="site-wordmark" href="/" aria-label="Pixelware, home"><span class="brand-icon" aria-hidden="true"></span>Pixelware<span class="brand-period">.</span></a><nav aria-label="Main navigation"><a class="nav-projects" href="/#projects">Projects <span data-project-count>06</span></a><a href="/blog">Blog</a><a class="nav-contact" href="mailto:o.ozbek@pixelware.nl">Let’s talk <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10M7 17 17 7"/></svg></a></nav></header>${body}<section class="contact-strip site-frame" id="contact" aria-labelledby="contact-title"><div><span class="eyebrow">AN OPEN CHANNEL</span><h2 id="contact-title">Have something in mind?</h2></div><a href="mailto:o.ozbek@pixelware.nl">Let’s build it.${arrow}</a></section><footer class="blog-site-footer site-frame">© ${new Date().getFullYear()} PIXELWARE <a href="/">Back to the website ${arrow}</a></footer></body></html>`;
}
export function articlePage(post, author, suggestions, origin, {preview=false,publishedAt,updatedAt,changelog=[]}={}) {
  const canonical=new URL('/blog/'+post.slug,origin).href;
  const image=new URL('/blog/share/'+post.slug+'.jpg',origin).href;
  const structuredData=!preview&&publishedAt ? {
    '@context':'https://schema.org',
    '@type':'BlogPosting',
    '@id':canonical+'#article',
    url:canonical,
    mainEntityOfPage:{'@type':'WebPage','@id':canonical},
    headline:post.title,
    description:post.summary,
    author:{'@type':'Person',name:author.name,url:author.linkedinUrl||new URL('/#about',origin).href},
    image:[image],
    datePublished:new Date(publishedAt).toISOString(),
    dateModified:new Date(updatedAt||publishedAt).toISOString(),
    inLanguage:'en',
  } : undefined;
  const related=suggestions.length ? suggestions.map(item=>`<a class="blog-suggestion" href="/blog/${e(item.slug)}">${item.thumbnailPreset?artHtml({preset:item.thumbnailPreset},item.id):`<img src="${e(item.thumbnailUrl)}" loading="lazy" alt="">`}<span><strong>${e(item.title)}</strong><p class="blog-suggestion-caption">${e(item.summary ?? "")}</p><small>${date(item.publishedAt)}</small></span></a>`).join('') : '';
  const body=`${preview?'<div class="blog-preview-notice">PRIVATE PREVIEW · Your unpublished changes</div>':''}<progress class="blog-reading-progress" max="100" value="0" aria-label="Reading progress"></progress><main><div class="blog-article-layout site-frame${suggestions.length?'':' without-suggestions'}"><article class="blog-article"><header class="blog-article-heading"><p class="blog-feed-tags">${post.tags.map(e).join(' · ')}</p><h1>${e(post.title || 'Untitled draft')}</h1><p class="blog-standfirst">${e(post.summary)}</p><div class="blog-byline">${authorHtml(author)}<span>${publishedAt?date(publishedAt):'Draft'} · ${Math.max(1,Math.ceil(post.markdown.split(/\s+/).length/200))} min read${updatedAt&&publishedAt&&updatedAt!==publishedAt?`<small>Updated ${date(updatedAt)}</small>`:''}</span></div></header><div class="blog-content">${renderMarkdown(post.markdown)}</div>${changelog.length?`<footer class="blog-changelog" aria-label="Article changelog"><span class="blog-changelog-label">Revision notes</span><ol>${changelog.map(change=>`<li><time datetime="${e(change.createdAt)}">${date(change.createdAt)}</time><p>${e(change.note || "Published revision")}</p></li>`).join('')}</ol></footer>`:''}</article>${suggestions.length?`<aside class="blog-suggestions" aria-label="Suggested posts"><div class="blog-suggestions-inner"><p class="blog-eyebrow">KEEP EXPLORING</p><h2>Suggested for you.</h2>${related}</div></aside>`:''}</div></main>`;
  return shell({title:post.title || 'Untitled draft',description:post.summary,canonical,body,image:preview?artUrl(post.thumbnail,post.id):image,origin,preview,structuredData});
}
function pagination(page,totalPages) {
  if(totalPages<=1)return "";
  const href=value=>`/blog${value>1?"?page="+value:""}`;
  const pages=[...new Set([1,totalPages,...Array.from({length:5},(_,index)=>page+index-2).filter(value=>value>=1&&value<=totalPages)])].sort((a,b)=>a-b);
  const numbers=pages.map((value,index)=>`${index&&value-pages[index-1]>1?'<span class="blog-pagination-gap" aria-hidden="true">…</span>':""}<a href="${href(value)}" aria-label="Page ${value}"${value===page?' aria-current="page"':""}>${value}</a>`).join("");
  return `<nav class="blog-pagination" aria-label="Blog pagination">${page>1?`<a href="${href(1)}">« First</a>`:'<span class="blog-pagination-disabled" aria-disabled="true">« First</span>'}${page>1?`<a rel="prev" href="${href(page-1)}">←︎ Previous</a>`:'<span class="blog-pagination-disabled" aria-disabled="true">←︎ Previous</span>'}${numbers}${page<totalPages?`<a rel="next" href="${href(page+1)}">Next →︎</a>`:'<span class="blog-pagination-disabled" aria-disabled="true">Next →︎</span>'}${page<totalPages?`<a href="${href(totalPages)}">Last »</a>`:'<span class="blog-pagination-disabled" aria-disabled="true">Last »</span>'}</nav>`;
}

export function indexPage(posts,_nextCursor,origin,{page=1,totalPages=1}={}) {
  return shell({title:page>1?`All posts · Page ${page}`:'All posts',description:'Articles from Pixelware.',canonical:`${origin}/blog${page>1?'?page='+page:''}`,origin,body:`<main class="blog-index site-frame"><h1>All posts</h1><div id="blog-feed" class="blog-feed">${posts.map(feedRow).join('')}</div>${!posts.length?'<p class="blog-empty">The first entry is on its way. Check back soon.</p>':''}${pagination(page,totalPages)}</main>`});
}
