#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../.." && pwd)"

rm -rf "$here/server" "$here/web"
mkdir -p "$here/server" "$here/web"
cp -R "$root/apps/server/dist/." "$here/server/"
cp -R "$root/apps/web/dist/." "$here/web/"
find "$root/node_modules" -name "spawn-helper" -exec chmod +x {} + 2>/dev/null || true
printf 'Assembled server and web into %s\n' "$here"
