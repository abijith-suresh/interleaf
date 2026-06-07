# Agent Instructions — Interleaf

## Overview

Interleaf is a client-side PDF editor for merge, extract, reorder, rotate, delete, and unlock flows. PDF processing stays in the browser. See `docs/CONTEXT.md` for the full product truth.

## Stack

- Astro 6, SolidJS, Tailwind CSS v4, TypeScript, Bun, Vitest
- pdf-lib (manipulation), pdf.js (rendering)

## Quick Commands

```sh
bun install          # Install deps
bun run dev          # Dev server at localhost:4321
bun run verify       # Full quality gate (type-check, lint, format, test, build)
```

Full workflow details in `docs/CONTRIBUTING.md`.

## Project Map

```
src/components/app/    SolidJS editor UI (Editor, Sidebar, PageGrid, PageTile, PageCanvas, Uploader)
src/components/shared/ Astro chrome (Nav, Footer, BottomCTA, PageHeader, NumberedRow)
src/controllers/       Page-state helpers (no DOM, no rendering)
src/services/          PDF load, render, and build (PDFService, PDFOperationsService)
src/pages/             Marketing, legal, editor, and OG routes
src/utils/             Download, password prompt, toast, transitions
src/**/__tests__/      Co-located unit tests
```

Full architecture in `docs/ARCHITECTURE.md`.

## Hard Rules

- **Never add server-side PDF handling.** All processing stays in the browser.
- **Never add uploads.** Files are read into browser memory only.
- **Never add analytics, tracking, or cookies.** Privacy is absolute.
- **Keep business logic in services/controllers**, not in page components.
- **Cover editor behavior with unit tests.**

Full constraints in `docs/CONTEXT.md`.

## Document Ownership

| File                   | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `README.md`            | User-facing. Product scope, stack, dev quickstart.              |
| `docs/CONTEXT.md`      | Product truth. Goals, non-goals, constraints, success criteria. |
| `docs/ARCHITECTURE.md` | Technical truth. Architecture, data flow, design decisions.     |
| `docs/CONTRIBUTING.md` | Dev workflow. Setup, conventions, testing, CI, git process.     |
| `AGENTS.md`            | This file. Agent instructions and document ownership.           |

When the product vision, architecture, or workflow changes, update the corresponding document. Keep these files as the single source of truth.
