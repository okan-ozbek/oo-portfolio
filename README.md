# Pixelware — Complexity under control

A static project showcase built with React, TypeScript, Vite/Vinext, and Tailwind CSS. A graphite palette, red accents, and a compact grid put the projects first. The six-card grid starts with the Visual Hardware IDE and includes five clearly labeled placeholders, with animated candlestick, network, and binary visuals; the market data is simulated. The public portfolio remains a static export. A private Node/SQLite service now powers the password-protected link studio at `/admin` and tracked redirects at `/r/<slug>`.

Native Canvas 2D renders the animated visuals without an animation dependency. Motion can be paused globally, respects reduced-motion preferences, and stops when canvases are outside the viewport or the tab is hidden.

## Local development

Use Node.js 22.13 or newer:

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. With `npm run dev`, `/admin` opens without a login on `localhost`, `127.0.0.1`, or `::1`. This development-only option is not enabled by the deployed server; production still requires its admin password. Local mutations retain origin and CSRF checks. First startup also generates ignored local credentials for tools that use password authentication. Credentials and SQLite data are excluded from Git and image builds. See [admin setup and GitHub Actions deployment](deploy/ADMIN.md). These commands work on Windows, macOS, and Linux.

The **Resumes** admin section accepts LaTeX projects with supporting files, finds
their compiled hyperlinks, creates tracking links per variant, and provides
downloadable PDFs. Start its isolated compiler with `npm run resume:compiler`
(Docker required). See [the resume workflow and deployment notes](deploy/RESUMES.md).

The **Blogs** workspace supports autosaved Markdown drafts, highlighted code,
Mermaid diagrams, resizable images, paired artwork presets, publishing, and
revision history. Published articles are served by the Node/SQLite service at
`/blog/<slug>` and appear after About me on the homepage. See [the writing
workflow and optional LinkedIn setup](deploy/BLOGS.md).

## Project workspace

Open **Projects** in /admin to create, edit, and delete homepage project cards. The first server startup backfills the six original cards once: Visual Hardware IDE is published and the other five are teasers. Deleting a backfilled card will not recreate it on restart.

Each project has a title, caption (the category line), brief description, destination URL, and a thumbnail selected from the same sixteen animated scenes as the blog editor. Existing projects retain their original artwork. Choose **Draft** to keep a card private, **Teaser** to display it as Coming soon without exposing its destination, or **Published** to display a clickable card title. Published projects require an HTTP(S) destination or a local path such as /blog/my-post. **Save project** applies the selected visibility and returns to the overview. Changes to a published project go live when saved; choose Draft to remove it from the homepage while working.

Projects persist in the existing SQLite database. The homepage loads visible projects from /api/public/projects, so edits do not require a static rebuild. The original static six-card showcase remains the fallback if that service is unavailable. The development proxy and NGINX deployment both route the public endpoint to the admin service.

## Build and check

```sh
npm run lint
npm run typecheck
npm test
npm start
```

`npm test` builds and validates the static export and tests the admin backend. `npm start` previews only the existing `dist/client/` export locally; build first. Use `npm run dev` for admin access. `npm run build` produces the same export without running the separate test suite. `npm run build:static` remains an alias for Docker and existing deployment commands.

Only `dist/client/` is public website output. `dist/server/` is an intermediate prerender artifact, not a production server to deploy.

Each build generates `dist/client/sitemap.xml` for `https://pixelware.nl/`. Section anchors are not listed separately. The backend maintains `/blog/sitemap.xml` for currently published articles; `public/robots.txt` advertises both sitemaps. When adding static pages, update the canonical URL list in `scripts/generate-sitemap.mjs`. The static sitemap is available in the built preview (`npm start`) and Docker deployment; `npm run dev` does not generate it. No build-time timestamp is used as a misleading content modification date.

## VPS deployment

Pushes to `master` automatically test and deploy the portfolio and admin service
through GitHub Actions once the VPS secrets are configured. Containers are
rebuilt and replaced while reusing the existing database and certificate volumes.
For an existing stack, set `VPS_COMPOSE_PROJECT` to its current Compose project
name first. See [the automatic deployment setup](deploy/ADMIN.md).

The current VPS uses project `oo-portfolio` in `/var/www/oo-portfolio` with a
separate shared Caddy proxy. Its workflow uses `compose.vps.yaml` and passwordless
sudo, reusing the existing `portfolio-web` network alias. The standalone commands
below are for a host where this application owns its HTTPS proxy.

Configure the runtime admin hash using [the admin deployment guide](deploy/ADMIN.md), point `pixelware.nl` to the VPS, allow TCP ports 80 and 443, then run:

```sh
docker compose up -d --build
```

NGINX serves the exported website and proxies the private Node/SQLite admin service. Caddy handles Let's Encrypt certificates, renewal, and HTTP-to-HTTPS redirects for **https://pixelware.nl**. The VPS only needs Docker Engine and Docker Compose; Node runs inside the containers.

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

### Blog and project views

The admin Blog and Project tables show unique device views, starting when analytics is installed. Opening a public article counts a blog view. Following a published project title opens a tracked redirect and counts a project view. Teaser cards, listings, private previews, HEAD requests, known bots, and explicit prefetches do not count.

A first-party HttpOnly cookie identifies an anonymous browser; SQLite stores only its hash per item and its first view date. Repeat visits never increment that item again while the cookie is retained, including across server restarts. No IP addresses, names, or browser fingerprints are collected. Another browser, clearing cookies, private browsing, or cookie expiry can count as another device. Counts cannot identify individual people and earlier traffic cannot be reconstructed.

Both workspaces include daily view graphs above their tables. Each line represents a published item or an item with historical views. The graph counts each device on its first-view date; it is not a cumulative total or a repeat-visit count. The same 7-day, 30-day, rolling-quarter, and rolling-year UTC ranges as Link analytics are available, along with hover details and keyboard navigation.
