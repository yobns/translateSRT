#!/usr/bin/env bash
# Start the Python backend in a background process and save its PID.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/translate"

# Create virtualenv if missing
if [ ! -d ".venv" ]; then
  echo "Creating virtualenv..."
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "Ensuring Python deps are installed (fast if already installed)..."
pip install -r requirements.txt >/dev/null 2>&1 || true

RUN_DIR="$REPO_ROOT/.run"
mkdir -p "$RUN_DIR"
LOG="$RUN_DIR/backend.log"
PIDFILE="$RUN_DIR/backend.pid"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Backend already running (PID $(cat "$PIDFILE")); logs: $LOG"
  exit 0
fi

echo "Starting backend (uvicorn) in background..."
# Use 127.0.0.1 to match frontend .env.local default
nohup .venv/bin/python -m uvicorn src.server.api:app --host 127.0.0.1 --port 8000 >"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "Started backend (PID $(cat "$PIDFILE")); logs: $LOG"

exit 0
