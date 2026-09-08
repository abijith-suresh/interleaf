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

## Hard Rules

These rules are enforceable invariants. Violating any of them is a defect even if tests pass.

### Privacy

- All PDF processing runs client-side in the browser. Never add server-side PDF handling.
- Files are read into browser memory only. Never add uploads.
- Never add analytics, tracking, or cookies. Privacy is absolute.

### Correctness

- Business logic lives in `src/services/` and `src/controllers/`, never in components. Components gather input, show state, and delegate.
- `PDFService` and `PDFOperationsService` cache by `File` reference. Both caches are cleared on session reset and component cleanup; any new flow must preserve both paths.
- Deletion marks pages; export filters marked pages. Page indices never shift while editing, so selection state stays valid.
- Selection indices must be remapped through `src/controllers/editor-page-state.ts` after any reorder.
- Page thumbnails render lazily through the IntersectionObserver in `EditorPageCanvas`. Do not render eagerly.
- The password prompt stays imperative (`src/utils/password-prompt.ts`) so it is available during any loading state.
- Unlock flow: owner-password PDFs open without a prompt; user-password PDFs prompt until correct or cancelled. Loading and rendering go through pdf.js; building output goes through pdf-lib.

### Consistency

- Follow the existing Astro, SolidJS, TypeScript, and Tailwind patterns.
- Use design tokens in `src/styles/global.css` before introducing one-off values.
- Keep the Swiss-industrial aesthetic: minimal, typographic, high contrast.
- Treat stale docs as defects. If product scope changes, update the Product Truth section of this file first, then code, then public copy.

## Documentation

- `README.md`: user-facing current behavior only.
- `CONTRIBUTING.md`: development workflow, commands, commits, PRs, and contribution rules.
- `AGENTS.md`: agent behavior, product truth, and hard rules.

Do not advertise unimplemented features in any of them.

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
- `pre-commit` runs `lint-staged`, `commit-msg` runs `commitlint`, and `pre-push` runs `bun run verify`.
- CI enforces quality and PR-title checks on pull requests.
- Squash merge is the expected merge strategy.
- Open one focused PR at a time, then stop and wait for review or merge feedback before continuing.
