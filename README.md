# Pixelware — Complexity under control

A static portfolio built with React, TypeScript, Vite/Vinext, and Tailwind CSS. The page includes an accessible navigation dialog, WebGL backgrounds, and an interactive Radish architecture card. Portfolio content lives in source files; there is no database, authentication service, or application API.

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
| `app/portfolio-content.ts` | Résumé copy, projects, technology groups, and contact links |
| `app/page.tsx` | Page layout and sections |
| `app/globals.css` | Palette, typography, responsive layout, and animations |
| `app/site-navigation.tsx` | Navigation dialog and section reveal effects |
| `app/wave-canvas.tsx` | WebGL backgrounds and motion controls |
| `app/radish-architecture.tsx` | Diagram, pointer tilt, bokeh, and motion controls |
| `app/layout.tsx` | Metadata and favicon |
| `components/ui/` | The two shared primitives used by the site: Button and Sheet |
| `public/icons/` | Technology SVGs and their license |
| `public/pixelware-logo.svg`, `public/favicon.svg` | Brand assets |
| `scripts/`, `tests/` | Static export and deployment checks |
| `deploy/` | NGINX, Caddy, and VPS instructions |

The Google Fonts stylesheet loads Faculty Glyphic, DM Sans, and IBM Plex Mono. The animated backgrounds are rendered by code rather than image assets.

Vinext requires the React/RSC Vite plugins and `react-server-dom-webpack` indirectly. Keep those dependencies even though page components do not import them. The `next` package supplies metadata/configuration types and TypeScript tooling; no Next.js server runs on the VPS. The static build uses the prerender runner from the pinned Vinext version, so verify the export when upgrading it.

Historical Sites metadata may remain under `.openai/`; it is not loaded by Vite or included in the Docker build. The active project no longer uses Sites/Cloudflare workers, D1, Drizzle, or ChatGPT sign-in.
