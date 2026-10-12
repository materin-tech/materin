# materin desktop

Native macOS desktop app (Tauri v2). The Tauri window spawns a bundled
`materin-server` child process on a free loopback port and navigates the
webview to `http://127.0.0.1:<port>/ui/` (the full materin Web GUI).

## Layout

- `src-tauri/` — Rust shell (`main.rs` ~130 lines, std only + tauri)
  - `src-tauri/tauri.conf.json` — Tauri 2 config
  - `src-tauri/binaries/` — build output: `materin-server` + `web/` assets
  - `src-tauri/target/release/bundle/macos/materin.app` — build product
- `web-dist-placeholder/` — minimal bootstrap page embedded in the binary;
  the shell navigates to the server URL at startup

## Build (macOS)

```bash
bash scripts/build-desktop.sh
```

Produces:

- `packages/desktop/src-tauri/target/release/bundle/macos/materin.app`
- `release/v<version>/materin-desktop.dmg`

The script compiles the server (Bun single-file executable), bundles the app,
injects `materin-server` + `web/` into `materin.app/Contents/MacOS/`, then
creates the DMG with `hdiutil`.

## Notes

- Server binary resolution: sibling `materin-server` next to the app binary
  (inside the bundle: `Contents/MacOS/`), dev fallback `../dist/materin-server`.
- The chosen port is written to `/tmp/materin-desktop.port` for testing.
- The server exits at startup if no provider key is configured
  (`ANTHROPIC_API_KEY` / config providers); the shell inherits the user env so
  a normal install with `~/.materin/config.json` or exported keys works.
- Windows/Linux builds are produced by CI: `.github/workflows/release.yml`
  (triggered by `v*` tags or manually via workflow_dispatch).
