#!/usr/bin/env bash
# Builds the React frontend and starts the Fastify backend on one port,
# serving the API (/api/v1/*) and the built app together.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Building frontend (VITE_API_BASE=/api)"
(cd "$ROOT_DIR/app" && VITE_API_BASE=/api npm run build)

echo "==> Starting backend on http://localhost:${PORT:-8080}"
cd "$ROOT_DIR/backend"
PORT="${PORT:-8080}" exec npx tsx src/server/index.ts
