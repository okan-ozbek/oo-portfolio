# Private link studio

The portfolio stays static on NGINX. A private Node service handles `/admin`,
`/api/admin/*`, and `/r/*`, with persistent SQLite storage and Caddy HTTPS.
It uses [Node's built-in SQLite](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html)
(Node 22.13+; experimental on Node 22), without new npm dependencies.

## Local draft

Run `npm ci` and `npm run dev`, then open the printed `/admin` URL.
First startup creates a random password in `.admin-local-password` and its
scrypt hash in `.env.admin`. Both are ignored by Git and Docker. The password
is not printed in logs. Read the file locally to sign in. Data lives in
`data/admin.sqlite`, also ignored. Keep these local files private.

Delete both credential files to generate replacements on next startup. Changing
the hash invalidates sessions without deleting links. Use a separate password
for production. `npm start` still previews **only** the static export; use
`npm run dev` for the complete local app.

## Links and measurement

Create a name, permanent slug, HTTP(S) destination, and optional source label.
Slug `resume-linkedin` produces `https://pixelware.nl/r/resume-linkedin`.
Put this URL in the resume. Create separate slugs for other placements to compare
performance. URLs use the configured origin, never the request Host header.
You can change destinations and pause links. Unknown/paused links return 404.
Slugs cannot be renamed or deleted, protecting URLs on published resumes.
Edits preserve counts. Admin destination previews do not count. Use Refresh to
fetch current totals.

Click activity plots a separate colored line for each active link. Choose Last
7 days, Last 30 days, Last quarter (rolling three calendar months), or Last year (rolling
twelve calendar months). Each range includes today, uses UTC daily counts, and
excludes the corresponding date three/twelve months ago. Month ends are clamped
to the last valid day before advancing to the inclusive start date. The summary
cards keep their total, 30-day, and today metrics regardless of the chart filter.
Paused links are omitted from the chart, but their counts remain in the
summary totals and return to the chart when reactivated. The links list expands
with the page and wraps into compact rows on smaller screens without internal
scrollbars.

Hover near a chart line to inspect its UTC date and daily click count. Overlapping
lines share a tooltip. Focus the chart and use Left/Right, Home/End, and Escape
to inspect dates or dismiss the tooltip with the keyboard.

Clicks count once per browser, per link, per hour. Repeated visits still redirect
immediately but do not increment totals or move the last-counted timestamp.
The hour starts with the last counted click; duplicates do not extend it, and
midnight does not reset it. Other links have independent cooldowns. Historical
counts from before this feature remain unchanged and cannot be deduplicated
retroactively from daily aggregates.

An anonymous random browser cookie lasts one hour after the latest normal link
visit. It is HttpOnly, host-only, SameSite=Lax (so it accompanies visits from
external resumes/social sites), and Secure in production. SQLite stores only its
SHA-256 hash paired with a link and cooldown expiry. Expired cooldown rows are
removed at startup, during redirect counting, and every minute. Cooldowns survive
container restarts, deployments, and admin password changes. No IP address,
referrer, or user agent is used for identification. These are not verified unique
people: clearing/blocking cookies, private browsing, other browsers/devices, and
bots can produce extra counts. Simultaneous first-ever requests before a browser
receives its first cookie can also count separately.

HEAD and explicit prefetch/prerender requests are excluded and do not set a
visitor cookie. UTC daily aggregates are retained. Redirect query strings are
not forwarded. There are no conversion metrics in this draft.

## Production password

Run `npm run admin:password`. Enter a password of 16–256 characters at the hidden
prompt. Save the password in your password manager, and the entire printed
`scrypt-v1:...` hash as the GitHub Actions secret **ADMIN_PASSWORD_HASH**.
No plaintext admin password is needed on GitHub or the VPS. Rotating the hash
and redeploying invalidates sessions while keeping links and counts.

## GitHub Actions → VPS

The current VPS uses `/var/www/oo-portfolio` and Compose project `oo-portfolio`.
Its separate Caddy stack in `/var/www/reverse-proxy` already serves HTTPS through
the external `pixelware-proxy` network. `compose.vps.yaml` reuses the base service
definitions and connects NGINX with the existing `portfolio-web` alias. It starts
only the portfolio and admin services, leaving the shared proxy and certificates
in their current stack. `compose.yaml` remains the standalone stack for a host
where this application also runs its own Caddy instance.

The `Deploy portfolio and link studio` workflow runs automatically on every push
to **master**, including merged pull requests. It can also be run manually from
the Actions tab with `master` selected. Other branches and pull-request events
cannot deploy. Before deployment it checks lint, types, static export, backend
tests, and a Docker test that rebuilds/replaces the admin container across two
release directories while preserving the database volume. Dependencies are
pinned to official action release commits.

Create an environment named `production`, restrict it to `master`,
and configure these environment secrets (repository secrets also work):

| Secret | Value |
| --- | --- |
| `ADMIN_PASSWORD_HASH` | Hash from the password command |
| `VPS_HOST` | VPS IPv4 address or DNS hostname |
| `VPS_USER` | Dedicated SSH deployment account |
| `VPS_SSH_KEY` | Its private SSH key |
| `VPS_KNOWN_HOSTS` | Verified OpenSSH known_hosts entry for the VPS |

Optionally set environment variable `VPS_PORT` (default 22). For a custom port,
known_hosts needs `[hostname]:port`. Verify the host fingerprint through the
provider console or another trusted channel; the workflow enforces verification.
The account needs passwordless `sudo -n bash` for the installer because the
deployment directory is owned by root. The workflow uploads as the SSH user and
runs only the installer through sudo. This is broad root access; the deployment
key and production environment must be restricted to trusted maintainers.
Docker, the shared proxy network/Caddy stack, DNS, and firewall must exist first.

Set the required environment variable `VPS_COMPOSE_PROJECT` to the existing VPS Compose
project name before the first automatic deployment. Find it with
`sudo docker compose ls` or the running containers' `com.docker.compose.project`
label. On the current VPS use `oo-portfolio`. The workflow fails before contacting
the VPS if this setting is missing; it does not guess a new project name.
Commit and push the workflow and application files to `master` after configuring
the secrets and variables. Deployment runs after the checks pass. An environment
approval rule, if configured in GitHub, still applies.

Source and hash transfer over SSH through the SSH user's `~/pixelware-incoming/`.
The root installer obtains that user's home from `SUDO_USER` and the system
account database. Releases are under `/var/www/oo-portfolio/releases/`; the
runtime hash lives in `/var/www/oo-portfolio/.deploy-secrets/` and is mounted as
a read-only Docker secret. It is
excluded from image builds and frontend `VITE_*` variables. The VPS must retain
the hash for authentication: GitHub Secrets controls delivery, not automatic
synchronization or encrypted storage at rest. Compose file secrets are read-only
bind mounts, not Swarm-encrypted secrets.

**Database preservation:** each release runs Docker Compose with
`-f compose.vps.yaml -p <project>`, builds, then runs
`up -d --force-recreate --wait`. The existing
`<project>_admin_data` named volume is reattached, preserving links, click counts,
and sessions. The workflow never removes volumes, prunes Docker resources, or
copies a development database over the server database. The shared Caddy stack
and its volumes are not changed. The first admin deployment creates an empty
database; locally created links are not migrated. Containers can be briefly
unavailable while being replaced.

After the first successful deployment, `/var/www/oo-portfolio/compose-project` records the
project name. A later run with a different `VPS_COMPOSE_PROJECT` fails before
altering the release or runtime secret, preventing an accidental switch to an
empty database. Do not change it as part of routine deployment. For an existing
deployment's first adoption, use its actual project name; no volume migration is
automated. Explicit custom volume names/other Compose overrides require carrying
those settings over before adopting this workflow.

Keep releases for rollback. Run `sudo docker compose -f compose.vps.yaml -p <your-project> up -d --build --wait`
from a previous release to roll code back. There is no automatic rollback or old
release cleanup. Inspect Docker logs after failed builds or health checks.
See [GitHub's secret setup](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
for environment-secret access rules and plan availability.

## Manual Docker startup

On the current shared-proxy VPS, use `sudo docker compose -f compose.vps.yaml
-p oo-portfolio ...` from a prepared release directory. Do not start the standalone
Caddy service there; ports 80/443 belong to `/var/www/reverse-proxy`.

The following commands are for a **standalone host** where this application owns
its HTTPS proxy:

Create `.deploy-secrets/` in the repo root with directory mode 0700, save the hash
in `.deploy-secrets/admin_password_hash`, and set file mode 0444. The private parent
protects it on the host; the file mode lets the non-root container user read its
bind mount regardless of the host user's numeric UID. Then run:

```sh
docker compose config --quiet
docker compose up -d --build --wait
```

The admin service has no published host port. NGINX proxies it over Docker's
private network. Production requires HTTPS. Changing `APP_ORIGIN` also requires
updating Caddy's hostname and DNS. Missing/malformed credentials prevent startup.

## Security and persistence

One owner password, no registration, email reset, or MFA. Scrypt uses fixed work
factors. Random opaque sessions are stored only as SHA-256 token hashes, expire
after 12 hours, and are revoked at logout/password rotation. Production cookies
use `Secure`, `HttpOnly`, `SameSite=Strict`, and the `__Host-` prefix. Mutations
require the configured Origin, JSON, and a session CSRF token. The public login
screen is reachable; private data and management APIs require a session.

Login failures are globally limited to 10 per 15-minute window, persisted across
restarts, with at most two concurrent password checks. A determined attacker
could exhaust the limit and temporarily deny sign-in; a VPN/IP allowlist or
identity provider can strengthen a later production version.

Admin responses/302 redirects use `Cache-Control: no-store`. Admin CSP prohibits
framing and inline scripts; indexing is disabled. Destinations are never fetched
by the backend, and SQL inputs use bound parameters. NGINX disables access logs
for tracked redirects. Review additional provider/proxy logs separately.

SQLite is on `admin_data`. Avoid `docker compose down -v`. Back up using SQLite's
backup facility or while the admin service is stopped; copying only a live
`.sqlite` file can omit WAL transactions. Treat backups as private. This draft
uses a single instance; do not scale writers across separate disks.

Run `npm run test:admin` for backend checks. `npm test` also builds/tests the public
portfolio. Verify the full Docker/HTTPS path on the deployment host.

For the isolated local Docker check, run `npm run build`, then
`docker build -f deploy/Dockerfile.admin -t pixelware-admin:draft .` and
`npm run test:admin:container`. This checks the non-root, read-only admin runtime,
secret mount, real NGINX proxy config, authentication, redirect counting, and
persistence after restart. It removes only its own temporary containers/network/
volume. It does not test public DNS or HTTPS certificate issuance.

`npm run test:deploy` separately exercises two Docker Compose builds from different
release folders under a random test project name. It checks that the container
ID changes, the mounted database volume stays the same, and saved links, counts,
and sessions survive. It deletes only its own disposable test resources. This
check also runs in GitHub Actions before every production deployment.
