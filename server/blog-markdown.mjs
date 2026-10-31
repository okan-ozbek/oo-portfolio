import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const imagePath = /^\/blog\/media\/[a-f0-9-]{36}$/;

export function embedUrl(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (['www.youtube.com', 'youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') ?? url.pathname.split('/embed/')[1];
      return /^[\w-]{11}$/.test(id ?? '') ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (['vimeo.com', 'player.vimeo.com'].includes(url.hostname)) {
      const id = url.pathname.split('/').pop();
      return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (url.hostname === 'codepen.io' && /^\/[\w-]+\/(pen|embed)\/[\w-]+\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace('/pen/', '/embed/'); url.search = '?default-tab=result'; return url.href;
    }
    if (url.hostname === 'codesandbox.io' && /^\/(s|embed)\/[\w-]+\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace('/s/', '/embed/'); return url.origin + url.pathname;
    }
    if (url.hostname === 'stackblitz.com' && /^\/edit\/[\w-]+\/?$/.test(url.pathname)) return url.origin + url.pathname + '?embed=1&view=preview';
    if (url.hostname === 'systems.pixelware.nl') return url.href;
  } catch { /* Invalid URLs render as text. */ }
  return null;
}

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
md.validateLink = value => /^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(value);
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index], language = token.info.trim().split(/\s/)[0].toLowerCase();
  if (language === 'mermaid') return `<div class="blog-diagram" data-mermaid><pre>${escapeHtml(token.content)}</pre></div>`;
  if (language === 'embed') {
    const url = embedUrl(token.content);
    if (!url) return `<p class="blog-embed-unavailable">Unsupported embed. Use a normal Markdown link, or a supported video/demo URL.</p>`;
    return `<figure class="blog-embed"><iframe src="${escapeHtml(url)}" title="Embedded content" loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" allow="fullscreen" referrerpolicy="no-referrer"></iframe><figcaption><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open embedded content ↗</a></figcaption></figure>`;
  }
  if (token.content.length > 100000) return defaultFence(tokens, index, options, env, self);
  const highlighted = hljs.getLanguage(language) ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value : escapeHtml(token.content);
  return `<div class="blog-code"><div class="blog-code-heading"><span>${escapeHtml(language || 'text')}</span><button type="button" data-copy-code>Copy code</button></div><pre><code class="hljs language-${escapeHtml(language.replace(/[^\w+-]/g, ''))}">${highlighted}</code></pre></div>`;
};
md.core.ruler.push('blog_image_sizes', state => {
  for (const block of state.tokens) {
    if (!block.children) continue;
    for (let i = 0; i < block.children.length; i++) {
      const image = block.children[i], next = block.children[i + 1];
      if (image.type !== 'image') continue;
      const match = next?.type === 'text' && /^\{width=(\d{1,3}) align=(left|center|right)\}/.exec(next.content);
      if (match) { image.attrSet('data-width', String(Math.max(10, Math.min(100, Number(match[1]))))); image.attrSet('data-align', match[2]); next.content = next.content.slice(match[0].length); }
    }
  }
});
md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index], src = token.attrGet('src');
  if (!imagePath.test(src ?? '')) return `<span class="blog-image-unavailable">[Upload this image to the post: ${escapeHtml(token.content)}]</span>`;
  const width = token.attrGet('data-width') ?? '100', align = token.attrGet('data-align') ?? 'center';
  return `<span class="blog-image align-${align}" style="width:${width}%" data-image-src="${escapeHtml(src)}" data-image-width="${width}" data-image-align="${align}"><img src="${src}" alt="${escapeHtml(token.content)}" loading="lazy" decoding="async">${token.attrGet('title') ? `<span class="blog-image-caption">${escapeHtml(token.attrGet('title'))}</span>` : ''}</span>`;
};
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('rel', 'noopener noreferrer');
  if (/^https?:/.test(tokens[index].attrGet('href') ?? '')) tokens[index].attrSet('target', '_blank');
  return self.renderToken(tokens, index, options);
};
export function renderMarkdown(source = '') { return md.render(source); }
export function referencedImages(post) {
  const ids = new Set([post.thumbnail?.assetId, post.banner?.assetId].filter(Boolean));
  for (const match of post.markdown.matchAll(/\/blog\/media\/([a-f0-9-]{36})/g)) ids.add(match[1]);
  return ids;
}
