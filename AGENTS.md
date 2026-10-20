# interleaf — agent brief
Interleaf is a PDF editor that runs entirely in your browser. Open PDFs and PNG or JPEG images together, review and shape their pages, unlock protected files, and export — with no uploads, accounts, or tracking.

## The Project
The promise is structural, not a policy: every operation runs client-side, files never leave the device, and the site loads no third-party resources. No accounts, no ads, no analytics, no cookies, no fingerprinting. Keep the product honest about what ships.

Non-goals — do not add without changing this section first: server-side PDF processing or uploads of any kind; accounts, signups, sync, or collaboration; tracking of any kind; speculative code kept for possible future expansion; public promises for unimplemented features.

Status: live. This section is the product truth; update it before changing scope, promises, or non-goals, then the code, then public copy.

## How I Work Here
- Run `bun run verify` before handoff. Write focused tests for what you touched; CI owns the full suite.
- Conventional Commits; types live in commitlint.config.ts. Squash merge. Never commit to main.
- Branch from the latest main. One focused PR per coherent change; stack or delay PRs that overlap in files.
- Change The Project first, then code, then public copy. Never advertise what is not implemented.
- How the app works is documented by the code and its tests, not by prose. Prose rots; document behavior where it lives.
- Use one canonical phrasing per concept; the copy and term rules live in CONTRIBUTING.md. Never use "upload" as a user action.
- Preserve the privacy model: no document uploads, no server-side processing, no accounts, no telemetry.

## Sources of Truth
| Fact | Where |
|---|---|
| Product intent | § The Project (this file) |
| Public product surface | README.md + code |
| Runtime behavior | code + tests |
| Commands & deps | package.json |
| Commit rules | commitlint.config.ts |

Code and tests are the authority; this file never overrides executable truth.
