# Contributing — Interleaf

This document describes the development workflow for Interleaf.

Read `AGENTS.md` first for product truth and agent behavior.

Do not expand product scope unless the Product Truth section of `AGENTS.md` is updated first.

## Setup

- [Bun](https://bun.sh) via [mise](https://mise.jdx.dev) (`mise.toml` pins the exact version)
- Node.js 24+ (for Astro compatibility in CI)

```sh
bun install
bun run dev        # http://localhost:4321
```

## Quality Gate

Before pushing, run:

```sh
bun run verify
```

This runs, in order:

1. `type-check` — `astro sync && astro check && tsc --noEmit`
2. `lint` — `biome lint .`
3. `format:check` — `biome format .`
4. `test` — `vitest run`
5. `build` — `astro build`

Fix formatting and lint automatically:

```sh
bun run lint:fix
bun run format
```

## Git Workflow

1. Branch from the latest `main`.
2. Make the smallest correct change.
3. Keep public copy, product truth, and implementation aligned.
4. Run `bun run verify` before push — it also runs automatically on `pre-push`.
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`, `build`.
6. Open one focused pull request against `main`, then stop and wait for review or merge feedback.

### Hooks

| Hook         | Action                                           |
| ------------ | ------------------------------------------------ |
| `pre-commit` | Runs `lint-staged` on staged files               |
| `commit-msg` | Validates commit message format via `commitlint` |
| `pre-push`   | Runs `bun run verify`                            |

### CI

CI runs on every PR to `main`:

- **quality**: full verify pass (type-check, lint, format:check, test, build)
- **pr-title**: enforces Conventional Commit format on PR titles
- **dependency-review**: audits dependency changes

## Versioning And Releases

Releases are automated by release-please from Conventional Commits. Versioning restarted at `0.0.1` for a fresh development phase.

- While the project is in private development, versions stay in the `0.0.x` range: before 1.0, both `feat:` and `fix:` commits bump the patch version (`bump-patch-for-minor-pre-major` in the release-please config).
- The first real release (`0.1.0`) is cut deliberately by the maintainer, via a `Release-As: 0.1.0` footer on the release PR; `1.0.0` is earned later.
- Release PRs and tags are created automatically after conventional commits land on `main`.

## Code Conventions

Follow the existing Astro, SolidJS, TypeScript, and Tailwind patterns. The code and its tests are the source of truth for how the app works; document behavior where it lives, in code, rather than in prose that drifts.

### Architecture

- **Services** (`src/services/`): PDF loading, rendering, and manipulation. No DOM, no UI.
- **Controllers** (`src/controllers/`): Pure stateless helpers for page-state logic.
- **Components** (`src/components/app/`): SolidJS editor UI. Delegate to services/controllers.
- **Shared components** (`src/components/shared/`): Astro chrome for marketing pages.
- **Utils** (`src/utils/`): Browser utilities (download, password prompt, toast, transitions).
- **Types** (`src/types/`): Shared interfaces and error classes.

### Testing

Tests are co-located with source: `src/**/__tests__/*.test.ts`.

```sh
bun run test         # Run once
bun run test:watch   # Watch mode
```

Cover services, controllers, utilities, and editor components. Use Vitest with the `jsdom` environment.

### Styling

- Tailwind CSS v4 with CSS-first `@theme` tokens in `global.css`.
- Editor-specific styles in `editor.css`.
- Use existing utility classes and CSS custom properties.
- Follow the Swiss-industrial aesthetic: minimal, typographic, high contrast.

## Documentation

- `README.md` — user-facing current behavior only.
- `AGENTS.md` — product truth and agent behavior.
- `CONTRIBUTING.md` — this file.

Update `AGENTS.md` before changing product promises or scope, this file when the workflow changes, and `README.md` when public behavior changes.
