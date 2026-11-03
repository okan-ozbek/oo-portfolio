#!/usr/bin/env bash
set -euo pipefail
# Called only after the three loaded CI images pass the container smoke tests.
# Push existing images, then pin deployment to the registry's content digests.
: "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}" "${GITHUB_ACTOR:?}" "${REGISTRY_TOKEN:?}"
image_root="ghcr.io/${GITHUB_REPOSITORY,,}"
printf '%s' "$REGISTRY_TOKEN" | docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
printf 'services:\n' > compose.images.yaml
for service in admin compiler portfolio; do
  target="$image_root-$service:$GITHUB_SHA"
  docker image tag "pixelware-ci-$service:$GITHUB_SHA" "$target"
  docker image push "$target"
  reference=''
  while IFS= read -r candidate; do
    if [[ "$candidate" == "$image_root-$service@sha256:"* ]]; then reference="$candidate"; fi
  done < <(docker image inspect "$target" --format '{{range .RepoDigests}}{{println .}}{{end}}')
  if [[ ! "$reference" =~ ^ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$ ]]; then
    printf 'No registry digest found for %s\n' "$service" >&2; exit 1
  fi
  printf '  %s:\n    image: %s\n' "$service" "$reference" >> compose.images.yaml
done
