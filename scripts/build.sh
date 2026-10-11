#!/usr/bin/env bash
# Build the SPA into web/dist, then check it is served by the backend.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root/web"
[ -d node_modules ] || npm install
npm run build
echo "built into $root/web/dist — start with: uv run llmimage serve"
