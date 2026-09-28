# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
# Keep downloaded packages across retries and show network/install-script progress.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --cache=/root/.npm --prefer-offline --loglevel=info --foreground-scripts
COPY . .
RUN npm run build:static

FROM nginx:stable-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist/client/ /usr/share/nginx/html/

# Run without root; all writable NGINX paths are under /tmp.
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
