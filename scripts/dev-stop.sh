#!/usr/bin/env bash
# Stop the background Python backend started by dev-start.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$REPO_ROOT/.run"
PIDFILE="$RUN_DIR/backend.pid"
LOG="$RUN_DIR/backend.log"

if [ ! -f "$PIDFILE" ]; then
  echo "No backend PID file found. Is the backend running? ($PIDFILE)"
  exit 1
fi

PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  echo "Stopping backend (PID $PID)..."
  kill "$PID"
  sleep 1
  if kill -0 "$PID" 2>/dev/null; then
    echo "Process still alive; sending SIGKILL"
    kill -9 "$PID" || true
  fi
else
  echo "Process $PID not running"
fi

rm -f "$PIDFILE"
echo "Stopped. Log file: $LOG"

exit 0
