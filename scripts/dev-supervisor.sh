#!/usr/bin/env bash
# Keeps `next dev` running: restarts it automatically if Turbopack crashes.
cd "$(dirname "$0")/.."
while true; do
  echo "[supervisor] starting next dev at $(date -u +%FT%TZ)"
  pnpm exec next dev -p 3000
  echo "[supervisor] next dev exited with $? — restarting in 3s"
  sleep 3
done
