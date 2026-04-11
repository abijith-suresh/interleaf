# interleaf

Local-first notes for quick writing, search, tabbed editing, and simple export.

## Requirements

- Bun

## Install

```bash
bun install
```

## Development

```bash
bun run dev
```

The app runs with Vite on `http://localhost:3000` by default.

## Build

```bash
bun run build
```

## Preview Production Build

```bash
bun run preview
```

## Typechecks

```bash
bun run typecheck
bun run typecheck:node
```

## Storage Model

- Notes are stored locally in the browser with IndexedDB.
- The app is local-first and does not require an account or backend.
- If browser storage is unavailable, the app keeps working in memory for the current session where practical.
- In that failure mode, a persistent banner warns that notes cannot be saved for future sessions.
- Export remains the intended backup path.

## Offline And PWA

- The app uses `vite-plugin-pwa` with the `generateSW` strategy.
- A web manifest is generated during build from `vite.config.ts`.
- Placeholder SVG icons are included so the build stays installable without adding a full exported icon set.
- If production deployment needs platform-specific PNG assets, replace `public/pwa-icon.svg` and `public/pwa-icon-maskable.svg` with final app icons.

## Deploy

- The current deployment model is static hosting.
- Build output is written to `dist/`.
- Any host that can serve the built files and service worker from the site root should work.
- Because notes are browser-local, data does not sync across browsers or devices.

## Verification

```bash
bun run build
bun run typecheck
bun run typecheck:node
```
