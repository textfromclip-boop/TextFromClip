#!/usr/bin/env bash
# Runs the full local E2E suite from a clean local D1: build, migrate, start server, run checks.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8799}"
npm run build >/dev/null
rm -rf .wrangler/e2e e2e/artifacts
npx wrangler d1 migrations apply DB --local -c e2e/wrangler.e2e.toml --persist-to .wrangler/e2e >/dev/null
node e2e/server.mjs "$PORT" > e2e/server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf "http://localhost:$PORT/api/health" >/dev/null && break; sleep 1; done
status=0
node e2e/walkthrough.mjs "http://localhost:$PORT" || status=1
node e2e/checks.mjs "http://localhost:$PORT" || status=1
node e2e/regression.mjs "http://localhost:$PORT" || status=1
exit $status
