#!/usr/bin/env bash
# Restarts the compiled backend (npm start) so its in-memory dbStore reloads from MySQL.
# Usage: scripts/restart-backend.sh [logfile]   (default /home/user/backend.log)
set -u
LOG="${1:-/home/user/backend.log}"
BACKEND_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
pkill -f "^node dist/src/main.js" 2>/dev/null
for i in $(seq 1 50); do pgrep -f "^node dist/src/main.js" >/dev/null || break; sleep 0.2; done
cd "$BACKEND_DIR" && setsid nohup node dist/src/main.js >>"$LOG" 2>&1 </dev/null &
for i in $(seq 1 120); do
  if curl -s -o /dev/null -w '%{http_code}' localhost:5000/api/docs-json 2>/dev/null | grep -q 200; then
    echo "backend up (pid $(pgrep -f '^node dist/src/main.js' | head -1))"; exit 0
  fi
  sleep 1
done
echo "backend did not come up; see $LOG"; exit 1
