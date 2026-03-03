#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-tatooine}"
DEST="/home/schorsch/docker/pob/dist"
WEB="packages/web"

cd "$(dirname "$0")"

echo "==> Building..."
cd "$WEB"
npx vite build
cd ../..

echo "==> Syncing to $HOST..."
rsync -az --delete \
  --info=progress2 \
  "$WEB/dist/" \
  "$HOST:$DEST/"

echo "==> Syncing deploy configs..."
rsync -az \
  deploy/docker-compose.yml deploy/nginx.conf \
  "$HOST:/home/schorsch/docker/pob/"

echo "==> Restarting containers..."
ssh "$HOST" "cd /home/schorsch/docker/pob && docker compose up -d"

echo "==> Done. Live at https://pob.awx.at"
