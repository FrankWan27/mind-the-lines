#!/usr/bin/env bash
# Local dev runner for Mind the Lines.
#
# This host (Amazon Linux 2, glibc 2.26) cannot run native Node 18+, and has no
# `docker compose`, so we run the node:20-bookworm dev image with plain
# `docker run`. Client -> http://localhost:5173, server -> http://localhost:3001.
set -euo pipefail

IMAGE=mind-the-lines-dev
NAME=mtl-dev
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building $IMAGE ..."
docker build -f "$DIR/Dockerfile.dev" -t "$IMAGE" "$DIR"

echo "Removing any previous $NAME container ..."
docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "Starting $NAME ..."
docker run -d --name "$NAME" \
  -v "$DIR":/app \
  -v /app/node_modules \
  -v /app/shared/node_modules \
  -v /app/server/node_modules \
  -v /app/client/node_modules \
  -p 127.0.0.1:3001:3001 \
  -p 127.0.0.1:5173:5173 \
  "$IMAGE" \
  sh -c "npm install && npm run dev"

echo
echo "Container starting (npm install + dev servers). Follow logs with:"
echo "  docker logs -f $NAME"
echo "Then open http://localhost:5173"
