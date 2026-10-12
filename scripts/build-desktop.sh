#!/usr/bin/env bash
#
# Build the materin macOS desktop app (.app + .dmg).
#
# Pipeline:
#   1. bun run web:build                          → packages/web/dist
#   2. bun build --compile server → src-tauri/binaries/materin-server (+ web/)
#   3. bunx @tauri-apps/cli build --bundles app   → materin.app
#   4. inject materin-server + web/ into materin.app/Contents/MacOS/
#   5. hdiutil create → release/<ver>/materin-desktop.dmg
#
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="$(pwd)"
VERSION="$(bun -e "console.log(require('./package.json').version)")"
BIN_DIR="packages/desktop/src-tauri/binaries"
APP="packages/desktop/src-tauri/target/release/bundle/macos/materin.app"

echo "==> materin desktop build (v${VERSION})"

# 1. Web GUI assets
echo "==> web:build"
bun run web:build

# 2. Server binary (self-contained Bun executable) + web assets beside it
echo "==> compiling materin-server"
mkdir -p "${BIN_DIR}/web"
bun build --compile --target=bun-darwin-arm64 packages/server/src/index.ts --outfile "${BIN_DIR}/materin-server"
chmod +x "${BIN_DIR}/materin-server"
cp packages/web/dist/index.html packages/web/dist/main.js "${BIN_DIR}/web/"

# 3. Tauri app bundle (app only; DMG is created manually below)
echo "==> tauri build"
(cd packages/desktop && bunx @tauri-apps/cli build --bundles app)

# 4. Inject the sidecar server + web assets into the .app
echo "==> injecting sidecar into materin.app"
cp "${BIN_DIR}/materin-server" "${APP}/Contents/MacOS/materin-server"
mkdir -p "${APP}/Contents/MacOS/web"
cp "${BIN_DIR}/web/index.html" "${BIN_DIR}/web/main.js" "${APP}/Contents/MacOS/web/"

# 5. DMG
echo "==> creating DMG"
STAGING="$(mktemp -d)"
cp -R "${APP}" "${STAGING}/"
mkdir -p "release/v${VERSION}"
DMG="release/v${VERSION}/materin-desktop.dmg"
hdiutil create -volname "materin" -srcfolder "${STAGING}" -ov -format UDZO "${DMG}"
rm -rf "${STAGING}"

echo "==> done: ${APP}"
echo "==> done: ${DMG}"
