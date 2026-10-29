#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "[Gideon] starting in $ROOT"

if [ ! -f "$ROOT/index.js" ]; then
  FOUND="$(find "$ROOT" -name index.js -not -path "*/node_modules/*" | head -n 1)"
  if [ -n "$FOUND" ]; then
    BOTDIR="$(dirname "$FOUND")"
    echo "[Gideon] index.js is inside $BOTDIR, moving files to root"
    shopt -s dotglob
    mv "$BOTDIR"/* "$ROOT"/ 2>/dev/null || true
    shopt -u dotglob
  fi
fi

if [ ! -f "$ROOT/index.js" ]; then
  echo "[Gideon] index.js still not found."
  echo "[Gideon] In Katabump File Manager, index.js must be in the server root, not inside another folder."
  ls -la "$ROOT"
  exit 1
fi

mkdir -p "$ROOT/session"

# Accept cred.json / creds.json from common upload locations
for src in \
  "$ROOT/session/creds.json" \
  "$ROOT/session/cred.json" \
  "$ROOT/creds.json" \
  "$ROOT/cred.json" \
  "$ROOT/session.json"
do
  if [ -f "$src" ]; then
    if [ "$src" != "$ROOT/session/creds.json" ]; then
      cp "$src" "$ROOT/session/creds.json"
      echo "[Gideon] copied session from $src"
    fi
    break
  fi
done

if [ ! -d "$ROOT/node_modules" ]; then
  echo "[Gideon] installing dependencies"
  npm install --omit=dev
fi

exec node "$ROOT/index.js"
