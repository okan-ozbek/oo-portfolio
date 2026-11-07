# Pixelware — Complexity under control

A static project showcase built with React, TypeScript, Vite/Vinext, and Tailwind CSS. A graphite palette, red accents, and a compact grid put the projects first. The six-card grid starts with the Visual Hardware IDE and includes five clearly labeled placeholders, with animated candlestick, network, and binary visuals; the market data is simulated. The homepage is rendered from live SQLite data by the Node service; Vite still produces a static fallback and the shared stylesheet. A private Node/SQLite service now powers the password-protected link studio at `/admin` and tracked redirects at `/r/<slug>`.

Native Canvas 2D renders the animated visuals without an animation dependency. Motion respects reduced-motion preferences, and stops when canvases are outside the viewport or the tab is hidden.

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

In **Books**, the written-page button opens a private Markdown note for each book.
It reuses the blog's single-surface Live editor: Markdown formats in place as you
write. Markdown source and Preview views are also available. Notes autosave;
**Save & done** saves before closing, and **Clear
note** removes the contents. Notes persist in SQLite with the book and are removed
when the book is deleted.

In the PDF reader, choose **＋ Note**, then click or tap the exact spot on a page.
Write in the live Markdown editor and choose **Save note**. Hold the marked **Drag**
handle to move a post-it, including to another page; use its bottom-right corner to
resize it horizontally and vertically. Arrow keys work on both handles, with Shift
for larger steps. Position and size persist and scale with PDF zoom. The editor's
preview uses the note's actual dimensions. **Hide notes / Show notes**
switches the overlays off and on, with the preference remembered in this browser.
Notes keep their relative position when zooming. They are stored separately from
the PDF and also appear as yellow cards in **Book Notes**. Click a card to open
its PDF page. Editing and deletion of PDF notes happen in the reader.

The **Blogs** workspace supports autosaved Markdown drafts, highlighted code,
Mermaid diagrams, resizable images, paired artwork presets, publishing, and
revision history. Published articles are served by the Node/SQLite service at
`/blog/<slug>` and appear after About me on the homepage. See [the writing
workflow and optional LinkedIn setup](deploy/BLOGS.md).

## Project workspace

Open **Projects** in /admin to create, edit, and delete homepage project cards. The first server startup backfills the six original cards once: Visual Hardware IDE is published and the other five are teasers. Deleting a backfilled card will not recreate it on restart.

Each project has a title, caption (the category line), brief description, destination URL, and a thumbnail selected from the same sixteen animated scenes as the blog editor. Existing projects retain their original artwork. Choose **Draft** to keep a card private, **Teaser** to display it as Coming soon without exposing its destination, or **Published** to display a clickable card title. Published projects require an HTTP(S) destination or a local path such as /blog/my-post. **Save project** applies the selected visibility and returns to the overview. Changes to a published project go live when saved; choose Draft to remove it from the homepage while working.

Projects persist in the existing SQLite database. The backend renders visible projects, the first blog page, and the resume link into the initial homepage HTML, so edits do not require a rebuild. The live homepage requires the Node service; npm start previews only the static fallback. The development proxy and NGINX deployment both route the public endpoint to the admin service.

## Build and check

```sh
npm run lint
npm run typecheck
npm test
npm start
```

`npm test` builds and validates the static export and tests the admin backend. `npm start` previews only the existing `dist/client/` export locally; build first. Use `npm run dev` for admin access. `npm run build` produces the same export without running the separate test suite. `npm run build:static` remains an alias for Docker and existing deployment commands.

Only `dist/client/` is public website output. `dist/server/` is an intermediate prerender artifact, not a production server to deploy.

The live /sitemap.xml index links to /sitemaps/pages.xml, /sitemaps/blogs.xml, and /sitemaps/resumes.xml. These are generated from SQLite on request, so published content and the selected website PDF are reflected immediately. Project write-ups use ordinary published blog URLs; project cards do not create separate sitemap entries. Public project edits update the homepage modification date. Draft autosaves and analytics do not change sitemap dates. The older /blog/sitemap.xml remains available for existing crawlers. Both development and NGINX proxy live sitemaps and /robots.txt to the backend. Static previews include fallback sitemaps; live content requires the backend.

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
| `app/showcase.tsx` | Project grid, navigation, contact, and footer |
| `app/globals.css` | Palette, typography, responsive layout, and animations |
| `app/data-visual.tsx` | Animated signal terrain, candlesticks, network cube, scrolling assembly and registers, 3D stack, black hole, and simulated P50/P99 latency chart |
| `app/market-feed.ts` | Deterministic simulated trades, evolving OHLC candles, volume, and changing bullish/bearish phases |
| `app/layout.tsx` | Metadata and favicon |
| `components/ui/`, `public/icons/` | Retained primitives and licensed icons from the earlier portfolio |
| `public/pixelware-logo.svg`, `public/favicon.svg` | Brand assets |
| `scripts/`, `tests/` | Static export and deployment checks |
| `deploy/` | NGINX, Caddy, and VPS instructions |

The Google Fonts stylesheet loads Space Grotesk and IBM Plex Mono. The hero remains animated. Public project and blog thumbnails include static generated SVG images or uploaded images in the initial HTML. JavaScript progressively enhances preset thumbnails into animations; uploaded images remain static. The image stays visible if JavaScript or animation loading fails. Manage live project cards in the Projects admin workspace. app/project-content.ts provides only the build-time fallback.

Vinext requires the React/RSC Vite plugins and `react-server-dom-webpack` indirectly. Keep those dependencies even though page components do not import them. The `next` package supplies metadata/configuration types and TypeScript tooling; no Next.js server runs on the VPS. The static build uses the prerender runner from the pinned Vinext version, so verify the export when upgrading it.

Historical Sites metadata may remain under `.openai/`; it is not loaded by Vite or included in the Docker build. The active project no longer uses Sites/Cloudflare workers, D1, Drizzle, or ChatGPT sign-in.

### Blog and project views

The admin Blog and Project tables show unique device views, starting when analytics is installed. Opening a public article counts a blog view. Published project links point directly to their destination for crawlers. With JavaScript enabled, a same-origin beacon counts the project open; the older tracked redirect URLs remain available. Without JavaScript, direct project links still work but do not record a project view. Teaser cards, listings, private previews, HEAD requests, known bots, and explicit prefetches do not count.

A first-party HttpOnly cookie identifies an anonymous browser; SQLite stores only its hash per item and its first view date. Repeat visits never increment that item again while the cookie is retained, including across server restarts. No IP addresses, names, or browser fingerprints are collected. Another browser, clearing cookies, private browsing, or cookie expiry can count as another device. Counts cannot identify individual people and earlier traffic cannot be reconstructed.

Both workspaces include daily view graphs above their tables. Each line represents a published item or an item with historical views. The graph counts each device on its first-view date; it is not a cumulative total or a repeat-visit count. The same 7-day, 30-day, rolling-quarter, and rolling-year UTC ranges as Link analytics are available, along with hover details and keyboard navigation.

The selected website resume is indexable at /resume.pdf, with an HTTP canonical header shared by its named URL. Other resume variants and all admin previews retain noindex. Clearing the website selection removes the PDF from the resume sitemap. robots.txt advertises the sitemap index and excludes admin, API, and tracking routes.

Published articles emit server-rendered BlogPosting JSON-LD with their live headline, description, author profile, canonical URL, share image, publication date, and last published modification date. Draft autosaves do not change this metadata, and previews and the blog index do not emit article markup. JSON is escaped for safe embedding and its exact content is authorized by a CSP hash.

The homepage uses a shared React renderer and hydration entry built by scripts/build-home.mjs. Production serves its compiled stylesheet and client bundle from /blog/assets/home.css and /blog/assets/home-client.js. Development watches the renderer and client while Vite handles the stylesheet. The admin image builds and includes these artifacts. Blog listings expose canonical /blog?page=N URLs and automatically load the next page near the bottom. A Load more posts button supports manual loading and retry; numbered page links remain available without JavaScript or if loading fails. Public preset SVG fallbacks are generated deterministically, cached in a bounded server cache, and served with browser caching. Thumbnail canvases are created only after JavaScript loads; animation respects reduced motion and pauses offscreen. The homepage and blog pages share the same footer and navigation counts.
