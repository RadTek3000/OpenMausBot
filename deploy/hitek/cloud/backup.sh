#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
image=${HITEK_BACKUP_IMAGE:?Set a digest-pinned restic image}
[[ "$image" =~ ^[a-z0-9][a-z0-9./_-]+@sha256:[a-f0-9]{64}$ ]]
test -f backup.env && test -s backup-password
compose=(docker compose --env-file .env --env-file release.env)
runtime=$("${compose[@]}" ps -q runtime)
test -n "$runtime"
volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$runtime")
test -n "$volume"
restic=(docker run --rm --read-only --tmpfs /tmp:mode=1777 --cap-drop ALL --cap-add DAC_READ_SEARCH
  --env-file backup.env -e RESTIC_PASSWORD_FILE=/run/secrets/restic-password -e RESTIC_CACHE_DIR=/tmp/restic-cache
  --mount "type=bind,src=$(pwd)/backup-password,dst=/run/secrets/restic-password,readonly"
  --mount "type=volume,src=$volume,dst=/snapshot,readonly" "$image")
case ${1:-backup} in
  init) "${restic[@]}" init ;;
  check) "${restic[@]}" check ;;
  backup)
    # SQLite and its WAL must be captured at one consistent, stopped point.
    trap '"${compose[@]}" up -d --wait --wait-timeout 180 runtime edge' EXIT
    "${compose[@]}" stop edge runtime
    "${restic[@]}" backup /snapshot --tag "$volume"
    ;;
  *) echo 'Usage: backup.sh [init|backup|check]' >&2; exit 1 ;;
esac
