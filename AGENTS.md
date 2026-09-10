# Agent Instructions — Interleaf

## Product truth

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

## Agent workflow

- Branch from the latest `main` before starting changes.
- Never commit directly to `main`.
- Commit and PR titles must use Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`, or `build`.
- Before push, run `bun run verify`.
- Squash merge is the expected merge strategy.
- Open one focused PR for each coherent change.
- Independent PRs may be developed and opened in parallel. Stack or delay PRs that overlap in files or depend on another change.

Detailed workflow, hooks, commands, and CI behavior live in `CONTRIBUTING.md`.
