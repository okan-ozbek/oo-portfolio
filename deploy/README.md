# Run Pixelware on your VPS

The Docker stack serves **https://pixelware.nl**. NGINX serves the static portfolio on the private Docker network; Caddy handles public HTTPS, Let's Encrypt certificate issuance and renewal, and HTTP-to-HTTPS redirects. Only Docker Engine and the Docker Compose plugin are needed on the VPS.

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

This defaults to `https://pixelware.nl` and checks TLS trust through normal HTTPS requests, HTTP redirects, page content, the health endpoint, script MIME type, cache headers, icons, RSC payload, and missing-file behavior. It only verifies this deployment after DNS points to it. To target a different deployment, set `PIXELWARE_URL`.

Docker is not installed in the development environment where this setup was prepared, so the actual image build, proxy configuration validation, and certificate issuance still need verification on the Docker host.

## Updating and stopping

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

Both services restart automatically unless explicitly stopped. NGINX runs as a non-root user with a read-only root filesystem and an ephemeral `/tmp` mount.

## Build without Docker

```sh
npm ci
npm run build:static
npm run test:static
```

The export is in `dist/client/`. Serve only that directory; `dist/server/` is an intermediate build artifact. Node is used only during the image build. The usual Sites development/build commands retain their original behavior. `build:static` uses the prerender runner from the pinned vinext version; rerun export tests when upgrading it.

Hashed `/assets/` files receive a one-year cache lifetime. HTML, RSC and unversioned files revalidate so updates appear promptly. Unknown routes and missing scripts return 404. The existing Google Fonts stylesheet still loads from Google; the runtime otherwise requires no server API, database or Cloudflare binding. New server actions, authentication or dynamic API routes would need a server-backed deployment instead of this static container.

References: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy Docker image and persistent storage](https://hub.docker.com/_/caddy), [NGINX Docker documentation](https://docs.nginx.com/nginx/admin-guide/installing-nginx/installing-nginx-docker/).
