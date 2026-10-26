# Start here

This is the Pixelware portfolio source, deployed as a static website through Docker, NGINX, and Caddy at https://pixelware.nl.

For local development:

```sh
npm ci
npm run dev
```

For a production build and local preview:

```sh
npm test
npm start
```

See [README.md](README.md) for the source map and checks, and [deploy/README.md](deploy/README.md) for VPS deployment and automatic HTTPS.

The private link studio is at `/admin`. Local startup generates a password in
`.admin-local-password`. Before Docker deployment, configure the runtime hash
using [deploy/ADMIN.md](deploy/ADMIN.md); it also explains GitHub Actions secrets.
