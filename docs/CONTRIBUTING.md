# Contributing — Interleaf

## Prerequisites

- [Bun](https://bun.sh) (version matches `.bun-version`)
- Node.js 24+ (for Astro compatibility in CI)

## Setup

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

1. `type-check` — `astro check && tsc --noEmit`
2. `lint` — `eslint .`
3. `format:check` — `prettier --check .`
4. `test` — `vitest run`
5. `build` — `astro build`

Individual steps:

```sh
bun run type-check
bun run lint
bun run format:check
bun run test
bun run build
```

Fix formatting and lint automatically:

```sh
bun run lint:fix
bun run format
```

## Git Workflow

1. Branch from latest `main`.
2. Write changes following existing patterns.
3. Run `bun run verify` — this runs automatically on `pre-push`.
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`.
5. Push and open a PR against `main`.

### Hooks

| Hook         | Action                                           |
| ------------ | ------------------------------------------------ |
| `pre-commit` | Runs `lint-staged` on staged files               |
| `commit-msg` | Validates commit message format via `commitlint` |
| `pre-push`   | Runs `bun run verify`                            |

### CI

CI runs on every PR to `main`:

- **quality**: Full verify pass (type-check, lint, format:check, test, build)
- **pr-title**: Enforces Conventional Commit format on PR titles
- **dependency-review**: Audits dependency changes

## Code Conventions

### Hard Rules

- **Never add server-side PDF handling.** All processing stays in the browser.
- **Never add uploads.** Files are read into browser memory only.
- **Never add analytics, tracking, or cookies.** Privacy is absolute.
- **Keep business logic in services/controllers**, not in page components.

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

Cover services, controllers, and utilities. Use Vitest with `jsdom` environment.

### Styling

- Tailwind CSS v4 with CSS-first `@theme` tokens in `global.css`.
- Editor-specific styles in `editor.css`.
- Use existing utility classes and CSS custom properties.
- Follow the Swiss-industrial aesthetic: minimal, typographic, high contrast.

## Adding Features

1. Open an issue first for discussion if the feature is substantial.
2. Implement in the appropriate layer (service, controller, component).
3. Add tests for new logic.
4. Update documentation if the feature changes product scope.
5. Keep the privacy model intact.

## Documentation

- `README.md` — user-facing only.
- `docs/CONTEXT.md` — product truth (goals, non-goals, constraints).
- `docs/ARCHITECTURE.md` — technical truth.
- `docs/CONTRIBUTING.md` — this file.
- `AGENTS.md` — agent instructions and document ownership.
