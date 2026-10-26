# Run Pixelware on your VPS

The Docker stack serves **https://pixelware.nl**. NGINX serves the static portfolio on the private Docker network; Caddy handles public HTTPS, Let's Encrypt certificate issuance and renewal, and HTTP-to-HTTPS redirects. Only Docker Engine and the Docker Compose plugin are needed on the VPS. A Node/SQLite sidecar handles the private link studio and redirects. **Before startup, configure its runtime hash using [ADMIN.md](ADMIN.md)**, which also covers GitHub Actions secret delivery.

## DNS and firewall

Before starting the stack:

- Set the DNS **A** record for `pixelware.nl` (usually host `@`) to your VPS's public IPv4 address.
- If an **AAAA** record exists, it must point to working IPv6 on this VPS; remove stale records if you are using IPv4 only.
- Allow inbound **TCP 80 and 443** in the VPS/provider firewall. Allow **UDP 443** too if you want HTTP/3. These ports must be available for Docker.
- Allow outbound HTTPS and DNS so Caddy can contact the certificate authority. If you use restrictive CAA records, allow `letsencrypt.org`.

The configured hostname is `pixelware.nl`; `www.pixelware.nl` is not configured. DNS is managed at your domain provider and is not changed by Docker.

## Start it

From the repository root on the VPS:

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 https
```

Open **https://pixelware.nl**. Once DNS resolves to the VPS and validation succeeds, Caddy obtains a trusted certificate automatically. The initial issuance can take a little time; the logs show progress and any DNS or connectivity failures. Visiting `http://pixelware.nl` redirects to HTTPS.

Certificate provisioning happens on your VPS when you start the stack. No certificate has been issued by preparing these files, and no DNS records have been changed.

## Certificate renewal and storage

Caddy renews certificates automatically while the container is running and starts using renewed certificates without a separate NGINX reload or host cron job. The `caddy_data` Docker volume persists certificates, private keys, and ACME account state. `caddy_config` stores Caddy configuration state.

Keep these volumes when updating or restarting. `docker compose down` preserves them; **do not use `docker compose down -v`** during routine updates because it deletes them. Treat backups of `caddy_data` as private key material. The NGINX container does not receive the certificate keys or publish a host port.

## Verify

```sh
docker compose exec portfolio nginx -t
docker compose exec https caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
curl -I http://pixelware.nl
curl -I https://pixelware.nl
curl -f https://pixelware.nl/healthz
docker compose logs --tail=50 https portfolio
```

The HTTP request should return a 308 redirect to HTTPS; the HTTPS requests should succeed with a trusted certificate. Do not use `curl -k`, which would hide certificate problems.

If Node 22.13+ is available on your workstation or VPS, run:

```sh
npm run test:container
```

This defaults to `https://pixelware.nl` and checks TLS trust through normal HTTPS requests, HTTP redirects, page content, the health endpoint, script MIME type, immutable cache headers, gzip through the proxy, conditional requests, icons, RSC payload, and missing-file behavior. It only verifies this deployment after DNS points to it. To target a different deployment, set `PIXELWARE_URL`.

Compression and cache behavior have been checked with the static export served through local NGINX and Caddy containers. Verify the full image build and certificate issuance on your Docker host as well.

## Updating and stopping

Pushes to `master` can now perform these updates automatically through the
configured GitHub Actions workflow. See [ADMIN.md](ADMIN.md) for secrets,
`VPS_COMPOSE_PROJECT`, branch restrictions, and the database-preservation check.
The workflow reuses named database and certificate volumes when replacing
containers; it does not remove volumes or overwrite the server database.

If a build appears stuck during dependency installation, use plain build output:

```sh
docker compose --progress plain build portfolio
docker compose up -d
```

The Dockerfile logs npm downloads and dependency install scripts. A BuildKit cache mount preserves downloaded packages between attempts, including when an install fails. The initial download still depends on VPS network speed and resources. Share the last npm log lines if it repeatedly retries or stops progressing; elapsed time alone does not identify the cause.

After bringing the latest source onto the VPS:

```sh
docker compose up -d --build
```

To refresh the Caddy, Node, and NGINX base images as well:

```sh
docker compose pull https
docker compose build --pull
docker compose up -d
```

To stop the stack while preserving certificate volumes:

```sh
docker compose down
```

All three services restart automatically unless explicitly stopped. NGINX and the admin service run as non-root users with read-only root filesystems. The admin database persists on its dedicated volume.

## Build without Docker

```sh
npm ci
npm run build:static
npm run test:static
```

The export is in `dist/client/`. Serve only that directory; `dist/server/` is an intermediate build artifact. Node is also used by the admin sidecar at runtime. `build:static` uses the prerender runner from the pinned vinext version; rerun export tests when upgrading it.

Hashed `/assets/` files receive `Cache-Control: public, max-age=31536000, immutable`, allowing browsers to reuse them without another request. HTML, RSC and unversioned files revalidate using ETag/Last-Modified so updates appear promptly. Unknown routes and missing scripts return 404 without immutable caching.

The build writes `.gz` versions of compressible files at gzip level 9. NGINX negotiates these with `gzip_static on`; `gzip_proxied any` allows compressed responses through Caddy's `Via` header. Compression costs occur during the build instead of on every VPS request. Keep the original files for clients that request uncompressed content. `Vary: Accept-Encoding` separates cached representations. The framework bundle is 189,805 bytes uncompressed and 58,912 bytes gzipped (about 69% less transfer). Browser developer tools may still show the original decoded size; check transferred bytes and `Content-Encoding: gzip`.

Visible graphics share a timer and animation frame. Candles redraw at 3 fps, preserving their four-second period; latency and instruction graphics use 10 and 12 fps. Other graphics use 20 or 24 fps according to canvas width. Offscreen graphics, hidden tabs, and paused animations stop scheduling work. Terrain vertices are reused within each draw and black hole disk paths are reused until resize. These changes reduce drawing work; gzip reduces transfer size, not the amount of JavaScript the browser parses.

The public portfolio remains static and loads its Google Fonts stylesheet from Google. The admin and tracked redirects use the separate Node/SQLite service described in [ADMIN.md](ADMIN.md).

References: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy Docker image and persistent storage](https://hub.docker.com/_/caddy), [NGINX Docker documentation](https://docs.nginx.com/nginx/admin-guide/installing-nginx/installing-nginx-docker/).

Compression references: [NGINX precompressed files](https://nginx.org/en/docs/http/ngx_http_gzip_static_module.html), [NGINX proxy compression](https://nginx.org/en/docs/http/ngx_http_gzip_module.html#gzip_proxied).
