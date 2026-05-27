# Agent Instructions — Interleaf

## Overview

- Interleaf is a client-side PDF editor for merge, extract, reorder, rotate, delete, and unlock flows.
- Keep PDF processing in the browser. Do not add uploads or server-side document handling.

## Stack

- Astro 6
- SolidJS editor UI
- Tailwind CSS v4
- TypeScript
- Bun
- Vitest

## Commands

- Install deps: `bun install`
- Dev server: `bun run dev`
- Quality gate: `bun run verify`
- Individual steps: `bun run type-check`, `bun run lint`, `bun run format:check`, `bun run test`, `bun run build`

## Project Map

- `src/components/app/`: editor UI, tiles, canvases, sidebar, and uploader
- `src/controllers/`: editor page-state helpers and orchestration utilities
- `src/services/`: PDF load, render, and manipulation logic
- `src/pages/`: marketing, legal, editor, and OG routes
- `src/utils/`: download, password prompt, toast, transitions, and helpers
- `tests/__tests__/`: unit tests for services and controllers

## Hard Rules

- Preserve the browser-only privacy model.
- Keep editor behavior covered by unit tests.
- Use the existing controller/service split instead of pushing business logic into page components.

## Git And CI

- Branch from the latest `main` before starting changes.
- Never commit directly to `main`.
- Commit and PR titles must use Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`.
- Before push, run `bun run verify`.
- `pre-commit` runs `lint-staged`, `commit-msg` runs `commitlint`, and `pre-push` runs `bun run verify`.
- CI enforces `quality` and `pr-title` checks on pull requests.

- Squash merge is the expected merge strategy.
