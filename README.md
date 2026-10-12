# Pixelware — Complexity under control

A static project showcase built with React, TypeScript, Vite/Vinext, and Tailwind CSS. A graphite palette, red accents, and a compact grid put the projects first. The six-card grid starts with the Visual Hardware IDE and includes five clearly labeled placeholders, with animated candlestick, network, and binary visuals; the market data is simulated. There is no database, authentication service, or application API.

Native Canvas 2D renders the animated visuals without an animation dependency. Motion can be paused globally, respects reduced-motion preferences, and stops when canvases are outside the viewport or the tab is hidden.

## Local development

Use Node.js 22.13 or newer:

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. These commands work on Windows, macOS, and Linux without Bash-specific wrappers.

## Build and check

```sh
npm run lint
npm run typecheck
npm test
npm start
```

`npm test` creates and validates the static export. `npm start` previews the existing `dist/client/` export locally; build first. `npm run build` produces the same export without running the separate test suite. `npm run build:static` remains an alias for Docker and existing deployment commands.

Only `dist/client/` is public website output. `dist/server/` is an intermediate prerender artifact, not a production server to deploy.

Each build generates `dist/client/sitemap.xml` for `https://pixelware.nl/`. The portfolio is a single page, so section anchors are not listed separately. `public/robots.txt` advertises the sitemap. When adding pages, update the canonical URL list in `scripts/generate-sitemap.mjs`. The generated sitemap is available in the built preview (`npm start`) and Docker deployment; `npm run dev` does not generate it. No build-time timestamp is used as a misleading content modification date.

## VPS deployment

Point `pixelware.nl` to your VPS, allow TCP ports 80 and 443, then run:

```sh
docker compose up -d --build
```

NGINX serves the exported website. Caddy handles Let's Encrypt certificates, automatic renewal, and HTTP-to-HTTPS redirects for **https://pixelware.nl**. The VPS only needs Docker Engine and Docker Compose; Node is used inside the build stage only.

See [the deployment guide](deploy/README.md) for DNS, certificate storage, verification, and updates. After deployment, `npm run test:container` checks the public HTTPS endpoint.

## Source map

| Location | Purpose |
| --- | --- |
| `app/project-content.ts` | Placeholder projects and contact links |
| `app/page.tsx` | Static page entry point |
| `app/showcase.tsx` | Project grid, navigation, contact, and motion control |
| `app/globals.css` | Palette, typography, responsive layout, and animations |
| `app/data-visual.tsx` | Animated signal terrain, candlesticks, network cube, scrolling assembly and registers, 3D stack, black hole, and simulated P50/P99 latency chart |
| `app/market-feed.ts` | Deterministic simulated trades, evolving OHLC candles, volume, and changing bullish/bearish phases |
| `app/layout.tsx` | Metadata and favicon |
| `components/ui/`, `public/icons/` | Retained primitives and licensed icons from the earlier portfolio |
| `public/pixelware-logo.svg`, `public/favicon.svg` | Brand assets |
| `scripts/`, `tests/` | Static export and deployment checks |
| `deploy/` | NGINX, Caddy, and VPS instructions |

The Google Fonts stylesheet loads Space Grotesk and IBM Plex Mono. The animated visuals are rendered by code rather than image assets. To fill the project grid later, edit `app/project-content.ts` and replace the placeholder status/layout in `app/showcase.tsx` when a real project is ready.

Vinext requires the React/RSC Vite plugins and `react-server-dom-webpack` indirectly. Keep those dependencies even though page components do not import them. The `next` package supplies metadata/configuration types and TypeScript tooling; no Next.js server runs on the VPS. The static build uses the prerender runner from the pinned Vinext version, so verify the export when upgrading it.

Historical Sites metadata may remain under `.openai/`; it is not loaded by Vite or included in the Docker build. The active project no longer uses Sites/Cloudflare workers, D1, Drizzle, or ChatGPT sign-in.
