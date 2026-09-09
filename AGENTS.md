# Agent Instructions — Interleaf

## Product Summary

Interleaf is a fully client-side PDF editor for the core tasks people reach for most: merge, extract, reorder, rotate, delete, and unlock.

It exists because online PDF tools are ad-infested and login-walled, and they usually require uploading documents to a server first. Interleaf gives the opposite guarantee structurally: every operation runs in the browser with `pdf-lib` and `pdf.js`, so files never leave the device.

## Product Truth

This section is the product source of truth. Update it before changing product scope, promises, or non-goals. Code and public copy follow this section, not the other way around.

### Core Promise

- Every operation runs entirely client-side, in the browser.
- Files never leave the device: no uploads, no server processing, no beacons.
- No accounts, signups, or login.
- No ads, tracking, analytics, or cookies.
- Keep the product honest about what is implemented today.

### Current Product Surface

The active product supports:

- merging multiple PDFs into one working set
- extracting selected pages into a new PDF
- reordering pages with drag and drop
- rotating pages in 90-degree steps, individually or by selection
- marking pages for deletion before export
- unlocking password-protected PDFs with an in-browser prompt
- locally rendered page thumbnails for inspection before export

These are the only current public product promises.

### Non-Goals

The product does not include, and must not gain without this section changing first:

- server-side PDF processing or uploads of any kind
- accounts, signups, sync, or collaboration
- ads, tracking, analytics, cookies, or fingerprinting
- speculative code kept only for possible future expansion
- public promises for features that are not implemented

## Documentation

- `README.md`: user-facing current behavior only.
- `CONTRIBUTING.md`: development workflow, commands, conventions, commits, and PR rules.
- `AGENTS.md`: product truth and agent behavior.

Do not advertise unimplemented features in any of them. Treat stale docs as defects: if product scope changes, update the Product Truth section of this file first, then code, then public copy.

How the app works is documented by the code and its tests, not by prose. Do not restate implementation details in docs; they rot.

## Commands

- Install dependencies: `bun install`
- Dev server: `bun run dev` (http://localhost:4321)
- Full quality gate: `bun run verify`
- Individual checks: `bun run type-check`, `bun run lint`, `bun run format:check`, `bun run test`, `bun run build`

## Git And CI

- Branch from the latest `main` before starting changes.
- Never commit directly to `main`.
- Commit and PR titles must use Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`, or `build`.
- Before push, run `bun run verify`.
- Squash merge is the expected merge strategy.
- Open one focused PR at a time, then stop and wait for review or merge feedback before continuing.

Detailed workflow, hooks, and CI behavior live in `CONTRIBUTING.md`.
