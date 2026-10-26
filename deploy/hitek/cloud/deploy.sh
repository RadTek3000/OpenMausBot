#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
node check.mjs validate .
image=${1:?Pass an immutable HITEK image reference}
if [[ ! "$image" =~ ^[a-z0-9][a-z0-9./_-]+(@sha256:[a-f0-9]{64}|:hitek-[a-f0-9]{40})$ ]]; then
  echo 'Expected a digest or hitek-<40 character commit SHA> image reference.' >&2
  exit 1
fi
umask 077
candidate=$(mktemp ./release.env.XXXXXX)
trap 'rm -f -- "$candidate"' EXIT
printf 'HITEK_IMAGE=%s\n' "$image" > "$candidate"
compose=(docker compose --env-file .env --env-file "$candidate")
"${compose[@]}" config --quiet
"${compose[@]}" pull runtime edge
# The edge shares the runtime's network namespace and must be recreated with it.
if ! "${compose[@]}" up -d --force-recreate --wait --wait-timeout 180 runtime edge; then
  if [[ -f release.env ]]; then
    echo 'Deployment failed; restoring the previously recorded image.' >&2
    docker compose --env-file .env --env-file release.env up -d --force-recreate --wait --wait-timeout 180 runtime edge
  fi
  exit 1
fi
mv -- "$candidate" release.env
echo 'Runtime started. Run the public HTTPS probe before admitting users.'
