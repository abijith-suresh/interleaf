# Interleaf — agent brief
Interleaf is a browser-only PDF editor; this brief tells agents how to work in its repo.

## The Project
Core promise: every operation runs in the browser, and files never leave the device — no uploads, no server processing, no beacons, no accounts, no ads, tracking, analytics, or cookies. Keep the product honest about what is implemented today.

Non-goals: server-side PDF processing or uploads; accounts, signups, sync, or collaboration; ads, tracking, analytics, cookies, or fingerprinting; speculative code kept for possible future expansion; public promises for features that are not implemented.

Status: live — this section is the product truth. Update it before changing scope, promises, or non-goals, then the code, then public copy.

What ships today — the only current public product promises:
- open one or more PDFs and PNG or JPEG images together, converting images to PDF pages
- add more PDFs or images to an existing workspace, and remove a source file with its pages
- extract selected pages into a new PDF
- reorder pages with drag and drop
- rotate pages in 90-degree steps, individually or by selection
- mark pages for deletion before export
- unlock password-protected PDFs with an in-browser prompt
- organize and read pages in persistent Pages and Document views within one workspace
- zoom read-only page previews up to 4x their fitted size, with pinch, drag, scroll, and keyboard panning; navigate with a compact filmstrip
- render page thumbnails locally for inspection
- losslessly compress one untouched PDF in the browser
- export selected or unmarked pages as PNG images in a local ZIP archive

## How I Work Here
- Quality gate: `verify` — run before handoff. `bun run verify` runs type-check, lint, format:check, test, and build; the `pre-push` hook runs it too.
- Commits: Conventional Commits; types live in commitlint.config.ts. Squash merges; never commit to main.
- Branch from the latest `main`. Open one focused PR per coherent change; stack or delay PRs that overlap in files.
- Update The Project first, then code, then public copy. Never advertise unimplemented features.
- How the app works is documented by the code and its tests, not by prose. Prose rots; document behavior where it lives.
- Use one canonical phrasing per concept. The copy and term rules live in CONTRIBUTING.md; never use "upload" as a user action.
- Keep the privacy model intact: no document uploads, no server-side processing, no accounts, no telemetry.

## Sources of Truth
| Fact | Where |
|---|---|
| Product intent | § The Project (this file) |
| Runtime behavior | code + tests |
| Commands & deps | package.json |
| Commit rules | commitlint.config.ts |

Code and tests are the authority; this file never overrides executable truth.

## Getting Around
- `src/services/` — PDF loading, rendering, and manipulation. No DOM, no UI.
- `src/controllers/` — pure stateless helpers for page-state logic.
- `src/components/app/` — SolidJS editor UI; delegates to services and controllers.
- `src/components/shared/` and `src/components/marketing/` — Astro chrome for marketing pages.
- `src/utils/` — browser utilities (download, password prompt, toast, transitions).
- `src/types/` — shared interfaces and error classes.
- `src/pages/` — Astro routes; `src/layouts/`, `src/styles/`, `src/scripts/`, and `src/fonts/` support them.
- `tests/e2e/` — Playwright browser tests. Unit tests are co-located at `src/**/__tests__/*.test.ts`.
- `tools/qpdf-wasm/` — qpdf compiled to WebAssembly and its build script.
- `public/` — static assets (fonts, qpdf, licenses).
