#!/bin/bash
#
# Publishes the static web export for a deployment: pull, build, sync, verify.
#
# Safe to run on a timer. It does nothing when the branch has not moved, so the normal case
# is a git fetch and an exit — which is what makes polling an acceptable trigger.
#
# Every EXPO_PUBLIC_* value is compiled into the bundle, so publishing is a rebuild and never
# a file copy. The dataset is refetched at runtime as well, but the bundle is what a visitor
# sees first and what an offline visitor sees at all.
#
# Usage:  publish-web.sh <site-host> [--force]
# Env:    REPO_DIR (default: the script's repository), SOURCE_URL (default: this repository)
#
set -euo pipefail

SITE_HOST="${1:-}"
[ -n "$SITE_HOST" ] || { echo "usage: publish-web.sh <site-host> [--force]" >&2; exit 2; }
FORCE="${2:-}"

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SOURCE_URL="${SOURCE_URL:-https://github.com/Black-Unicorn-Design-Studio/fresh-food-map}"
cd "$REPO_DIR"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
before=$(git rev-parse HEAD)
git fetch --quiet origin "$BRANCH"
after=$(git rev-parse "origin/$BRANCH")

if [ "$before" = "$after" ] && [ "$FORCE" != "--force" ]; then
  exit 0                      # nothing merged; say nothing, so the timer stays quiet
fi

echo "publishing $BRANCH: ${before:0:7} -> ${after:0:7}"
git merge --ff-only "origin/$BRANCH"

# Node lives in a container so the host needs none. The same major the service runs on.
docker run --rm -v "$PWD:/app" -w /app \
  -e EXPO_PUBLIC_INTAKE_URL="https://$SITE_HOST/intake" \
  -e EXPO_PUBLIC_SOURCE_URL="$SOURCE_URL" \
  -e EXPO_PUBLIC_DATA_URL="https://$SITE_HOST/markets.json" \
  node:22-bookworm-slim sh -c 'npm ci && npm run build:web'

# Into `web/`, never onto it. `expo export` replaces its output directory, and a bind mount
# follows the inode it was given — rebuilding the directory Caddy mounts leaves it serving
# one that no longer exists, 404ing every path while the files sit correctly on the host.
# Syncing contents keeps the inode, so nothing needs restarting to publish.
rsync -a --delete dist/ web/

# The publish is not finished until what is served matches what was merged. Everything this
# script does is silent when it half-works: a stale web/, a truncated sync, a build that
# produced the wrong dataset. Compare, and fail loudly, so the timer's failure mail is the
# alarm rather than somebody noticing weeks later that a market never appeared.
docker run --rm -v "$PWD:/app" -w /app node:22-bookworm-slim \
  npx tsx scripts/verify-published.ts "https://$SITE_HOST/markets.json"

echo "published $BRANCH at ${after:0:7}"
