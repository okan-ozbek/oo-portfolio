import { createElement as h } from 'react';

export const siteContact = { email: 'o.ozbek@pixelware.nl', github: 'https://github.com/okan-ozbek' };

function arrow(down = false) {
  return h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: down ? 'M7 17h10V7M7 7l10 10' : 'M7 7h10v10M7 17 17 7' }));
}

// The same component renders in the hydrated homepage and server-rendered blog.
export function SiteFooter({ resumeAvailable = false, frame = false } = {}) {
  return h('footer', { className: `site-footer${frame ? ' site-frame' : ''}` },
    h('p', { className: 'mono' }, `© ${new Date().getFullYear()} PIXELWARE`),
    h('div', { className: 'footer-links' },
      resumeAvailable && h('a', { href: '/resume.pdf', download: true }, 'Resume PDF ', arrow(true)),
      h('a', { href: siteContact.github, target: '_blank', rel: 'noreferrer' }, 'GitHub ', arrow()),
      h('a', { href: `mailto:${siteContact.email}` }, 'Email ', arrow())));
}
