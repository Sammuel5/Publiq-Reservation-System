#!/usr/bin/env bash
# Local MongoDB runner for development/testing in this sandbox.
#
# Production uses MongoDB Atlas (MONGODB_URI in .env.local / Vercel env vars).
# This script only exists so the app can be exercised end-to-end here, including
# a single-node replica set so transactions behave the way they do on Atlas.
#
#   ./scripts/dev-mongodb.sh start | stop | status | logs
set -euo pipefail

VERSION="${MONGO_VERSION:-7.0.14}"
ROOT="$HOME/.cache"
BIN_DIR="$ROOT/mongodb-bin"
DATA_DIR="$ROOT/mongodb-data"
LOG_FILE="$ROOT/mongodb.log"
PID_FILE="$ROOT/mongodb.pid"
PORT="${MONGO_PORT:-27017}"
REPL_SET="rs0"

tarball="mongodb-linux-x86_64-debian12-${VERSION}.tgz"
url="https://fastdl.mongodb.org/linux/${tarball}"

ensure_binary() {
  if [ -x "$BIN_DIR/bin/mongod" ]; then return 0; fi
  echo "→ Downloading MongoDB ${VERSION}…"
  mkdir -p "$BIN_DIR"
  curl -fsSL "$url" -o "$ROOT/$tarball"
  tar -xzf "$ROOT/$tarball" -C "$ROOT"
  rm -rf "$BIN_DIR"
  mv "$ROOT/mongodb-linux-x86_64-debian12-${VERSION}" "$BIN_DIR"
  rm -f "$ROOT/$tarball"
  echo "✓ mongod installed at $BIN_DIR/bin/mongod"
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

case "${1:-start}" in
  start)
    ensure_binary
    if is_running; then
      echo "✓ mongod already running (pid $(cat "$PID_FILE")) on port $PORT"
      exit 0
    fi
    mkdir -p "$DATA_DIR"
    "$BIN_DIR/bin/mongod" \
      --dbpath "$DATA_DIR" \
      --port "$PORT" \
      --bind_ip 127.0.0.1 \
      --replSet "$REPL_SET" \
      --logpath "$LOG_FILE" \
      --logappend \
      --fork \
      --pidfilepath "$PID_FILE" >/dev/null
    echo "✓ mongod started on 127.0.0.1:$PORT (replSet $REPL_SET, data: $DATA_DIR)"
    ;;
  stop)
    if is_running; then
      "$BIN_DIR/bin/mongod" --dbpath "$DATA_DIR" --shutdown >/dev/null 2>&1 || kill "$(cat "$PID_FILE")"
      echo "✓ mongod stopped"
    else
      echo "• mongod not running"
    fi
    rm -f "$PID_FILE"
    ;;
  status)
    if is_running; then
      echo "✓ running (pid $(cat "$PID_FILE")) port $PORT"
    else
      echo "✗ not running"
    fi
    ;;
  logs)
    tail -n "${2:-40}" "$LOG_FILE"
    ;;
  *)
    echo "Usage: $0 {start|stop|status|logs}" >&2
    exit 1
    ;;
esac
