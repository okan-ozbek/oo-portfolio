#!/usr/bin/env bash
set -euo pipefail
umask 077
deploy_user="${SUDO_USER:-$(id -un)}"
deploy_home="$(getent passwd "$deploy_user" | cut -d: -f6)"
if [[ -z "$deploy_home" || "$deploy_home" != /* ]]; then
  printf 'Cannot determine the SSH deployment account home.\n' >&2
  exit 1
fi
incoming="$deploy_home/pixelware-incoming"
root="/var/www/oo-portfolio"
project="${1:-pixelware}"
if [[ ! "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  printf 'Invalid Compose project name.\n' >&2
  exit 1
fi
project_file="$root/compose-project"
if [[ -f "$project_file" && "$(cat "$project_file")" != "$project" ]]; then
  printf 'Compose project differs from the previous deployment. Restore VPS_COMPOSE_PROJECT to the value in %s to reuse the database volume.\n' "$project_file" >&2
  exit 1
fi
mkdir -p "$root/releases" "$root/.deploy-secrets"
chmod 700 "$root/.deploy-secrets" "$incoming"
release="$(mktemp -d "$root/releases/release.XXXXXXXX")"
tar -xzf "$incoming/source.tgz" -C "$release"
# The parent is private. Mode 0444 lets the non-root container user read the
# mounted hash independently of the deployment user's numeric UID.
install -m 0444 "$incoming/admin_password_hash" "$root/.deploy-secrets/admin_password_hash"
ln -s "$root/.deploy-secrets" "$release/.deploy-secrets"
cd "$release"
compose_file="$release/compose.vps.yaml"
# Keep this project name fixed to preserve data and certificate volumes.
docker compose -f "$compose_file" -p "$project" config --quiet
docker compose -f "$compose_file" -p "$project" build
# Recreate even when image/config are unchanged: hashes are loaded at startup,
# and Compose does not notice a changed file-secret's contents.
docker compose -f "$compose_file" -p "$project" up -d --force-recreate --wait --wait-timeout 180
printf '%s\n' "$project" > "$project_file"
ln -sfn "$release" "$root/current"
rm -f "$incoming/source.tgz" "$incoming/admin_password_hash"
printf 'Deployment ready: %s\n' "$release"
