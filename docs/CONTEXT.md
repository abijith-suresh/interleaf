# Context — Interleaf

## Why Interleaf Exists

Interleaf is a browser-based PDF utility that replaces ad-infested, login-walled tools like iLovePDF. Every operation runs client-side. No uploads, no accounts, no tracking.

## Target Users

1. **The maintainer** — daily PDF tasks without privacy compromises.
2. **Anyone** who needs to edit PDFs and values privacy.
3. Serves as a **portfolio piece** — demonstrating clean product design and engineering.

## Goals

- Core PDF operations working reliably: merge, extract, reorder, rotate, delete.
- Unlock password-protected PDFs without any server involvement.
- Superior UI/UX compared to existing PDF tools — clean, fast, intuitive.
- Complete privacy guarantee — files never leave the browser.
- Present as a proper product with marketing pages, privacy policy, and values.

## Non-Goals / Hard Constraints

| Constraint   | Detail                                             |
| ------------ | -------------------------------------------------- |
| No accounts  | No registration, no login, no user identity.       |
| No ads       | No advertising of any kind.                        |
| No analytics | No tracking, no telemetry, no data collection.     |
| No servers   | No uploads, no server-side processing, no backend. |
| No cookies   | No client-side storage for tracking.               |
| No tracking  | Files, behavior, and usage are never observed.     |

These constraints are absolute and non-negotiable.

## Success Criteria

1. All core operations work correctly without bugs or data corruption.
2. The editor handles edge cases gracefully (encrypted PDFs, large files, mixed sources).
3. Users trust the privacy claim — verifiable by inspecting network activity.
4. The product feels polished and professional as both a utility and a portfolio piece.

## Version Philosophy

Interleaf lives in `0.x.x` version space indefinitely. There is no target `1.0.0` milestone. Features are added incrementally as needs arise. This is a living project, not a release-driven one.
