#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SKIP_BUILD=0
if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing frontend dependencies..."
  npm install
fi

if [[ $SKIP_BUILD -eq 0 ]]; then
  echo "Building frontend..."
  npm run build
fi

echo "Starting Flask app on http://127.0.0.1:5000 ..."
exec python3 app.py
