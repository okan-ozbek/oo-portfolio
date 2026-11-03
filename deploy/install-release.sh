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
trap 'rm -f "$incoming/registry-auth"' EXIT
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
if [[ ! -s "$release/compose.images.yaml" ]]; then
  printf 'The release is missing its tested image manifest. Refusing to rebuild on the VPS.\n' >&2
  exit 1
fi
# The parent is private. Mode 0444 lets the non-root container user read the
# mounted hash independently of the deployment user's numeric UID.
install -m 0444 "$incoming/admin_password_hash" "$root/.deploy-secrets/admin_password_hash"
ln -s "$root/.deploy-secrets" "$release/.deploy-secrets"
cd "$release"
compose_file="$release/compose.vps.yaml"
image_file="$release/compose.images.yaml"
compose=(docker compose -f "$compose_file" -f "$image_file" -p "$project")
# The job token expires after deployment; never leave registry credentials on
# the VPS or use a long-lived account token for image pulls.
export DOCKER_CONFIG
DOCKER_CONFIG="$(mktemp -d /tmp/pixelware-registry.XXXXXXXX)"
cleanup() {
  rm -f "$incoming/registry-auth"
  if [[ "$DOCKER_CONFIG" == /tmp/pixelware-registry.* ]]; then rm -rf -- "$DOCKER_CONFIG"; fi
}
trap cleanup EXIT
IFS= read -r registry_user < "$incoming/registry-auth"
if [[ ! "$registry_user" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*(\[bot\])?$ ]]; then
  printf 'Invalid registry account.\n' >&2; exit 1
fi
sed -n '2p' "$incoming/registry-auth" | docker login ghcr.io --username "$registry_user" --password-stdin
rm -f "$incoming/registry-auth"
# Keep this project name fixed to preserve data and certificate volumes.
"${compose[@]}" config --quiet
pull_started=$SECONDS
"${compose[@]}" pull --policy always
printf 'Tested image pulls completed in %ss.\n' "$((SECONDS - pull_started))"
# Recreate even when image/config are unchanged: hashes are loaded at startup,
# and Compose does not notice a changed file-secret's contents.
startup_started=$SECONDS
"${compose[@]}" up -d --no-build --force-recreate --wait --wait-timeout 180
printf 'Container startup completed in %ss.\n' "$((SECONDS - startup_started))"
printf '%s\n' "$project" > "$project_file"
ln -sfn "$release" "$root/current"
rm -f "$incoming/source.tgz" "$incoming/admin_password_hash"
printf 'Deployment ready: %s\n' "$release"
