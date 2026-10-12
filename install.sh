#!/bin/sh
# install.sh: honest local build — no release downloads.
# Builds the single-binary CLI from source with Bun.
set -e

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required to build materin."
  echo "install it first: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

cd "$(dirname "$0")"

echo "[1/3] bun install"
bun install

echo "[2/3] web build"
bun run web:build

echo "[3/3] compile single binary"
bun run compile

echo ""
echo "done. binary at: $(pwd)/dist/materin"
echo "make it available on PATH, e.g.:"
echo "  sudo cp dist/materin /usr/local/bin/materin"
