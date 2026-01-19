#!/usr/bin/env bash
set -euo pipefail

# redeployGit.sh
# Usage: run from the project folder on the server (or call it directly)
# - Force-sync to origin/master (hard reset)
# - Preserve existing .env
# - Run npm install if package.json exists
# - Restart the app with pm2 using --update-env

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

echo "[redeploy] repo: $REPO_DIR"

# Backup .env to avoid overwriting it
if [ -f .env ]; then
  echo "[redeploy] backing up .env -> .env.bak"
  cp .env .env.bak
fi

echo "[redeploy] fetching origin"
git fetch origin

echo "[redeploy] hard resetting to origin/master"
git reset --hard origin/master

# Remove untracked files but exclude .env
echo "[redeploy] cleaning untracked files (excluding .env)"
git clean -fd -e .env || true

# Restore .env from backup if present
if [ -f .env.bak ]; then
  echo "[redeploy] restoring .env"
  mv -f .env.bak .env
fi

# Install dependencies if package.json changed or node_modules missing
if [ -f package.json ]; then
  if [ ! -d node_modules ]; then
    echo "[redeploy] node_modules missing, running npm ci"
    npm ci --production || npm install --no-audit --no-fund
  else
    echo "[redeploy] node_modules present, skipping npm install"
  fi
fi

# Restart via pm2, prefer restarting existing process named 'buddybuy'
if command -v pm2 >/dev/null 2>&1; then
  echo "[redeploy] restarting pm2 process 'buddybuy' with --update-env"
  if pm2 describe buddybuy >/dev/null 2>&1; then
    pm2 restart buddybuy --update-env
  else
    echo "[redeploy] process 'buddybuy' not found, starting server.js as 'buddybuy'"
    pm2 start server.js --name buddybuy --update-env
  fi
else
  echo "[redeploy] pm2 not found in PATH. Start manually: node server.js &"
fi

echo "[redeploy] done. current HEAD: $(git rev-parse HEAD)"
