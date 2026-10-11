#!/usr/bin/env bash
# Run the backend and the Vite dev server together (hot reload on both sides).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${LLMIMAGE_PORT:-8765}"

(cd "$root" && uv run llmimage serve --port "$port") &
backend=$!
trap 'kill $backend 2>/dev/null || true' EXIT

until curl -sf "http://127.0.0.1:${port}/api/health" >/dev/null; do sleep 0.3; done
echo "backend on http://127.0.0.1:${port}"
cd "$root/web"
[ -d node_modules ] || npm install
LLMIMAGE_PROXY_TARGET="http://127.0.0.1:${port}" npm run dev
