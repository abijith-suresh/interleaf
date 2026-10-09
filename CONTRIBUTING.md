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
6. Open a focused pull request against `main` for each coherent change. Independent pull requests may be developed and reviewed in parallel. Stack or delay pull requests that overlap in files or depend on another change.

### Hooks

| Hook         | Action                                           |
| ------------ | ------------------------------------------------ |
| `pre-commit` | Runs `lint-staged` on staged files               |
| `commit-msg` | Validates commit message format via `commitlint` |
| `pre-push`   | Runs `bun run verify`                            |

### CI

CI runs on every PR to `main`:

- **ci**: shared Astro pipeline — type-check, lint, format:check, test, build, and Playwright browser tests
- **gate**: aggregates `ci`, `dependency-review`, and `qpdf`; this is the required branch-protection check
- **pr-title**: enforces Conventional Commit format on PR titles
- **dependency-review**: audits dependency changes
- **qpdf**: builds and smoke-tests the qpdf WASM module when its files change

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

Browser tests live in `tests/e2e` and use Playwright against a preview build:

```sh
bunx playwright install chromium   # once per machine
bun run test:e2e
```

CI runs the suite in Chromium, Firefox, and WebKit.

### Styling

- Tailwind CSS v4 with CSS-first `@theme` tokens in `global.css`.
- Editor-specific styles in `editor.css`.
- Use existing utility classes and CSS custom properties.
- Follow the Swiss-industrial aesthetic: minimal, typographic, high contrast.

## Copy And Voice

All user-facing copy — marketing pages, editor strings, statuses, toasts, social previews — follows one written standard. It adapts rules from ASD-STE100 Simplified Technical English to product copy, with mainstream web UX writing guidance (NN/g, Microsoft, and Mailchimp house styles): short declarative sentences, active voice, present tense, second person, concrete verbs, and exactly one canonical phrasing per concept.

### Mechanics

- Use sentence case for headings, buttons, links, and page titles. Page titles read `<Page> — Interleaf`.
- Write one idea per sentence. Aim for 15 words; cap at 25.
- Use active voice, present tense, and "you/your" for anything instructional.
- Avoid exclamation marks, hype adjectives, and idioms in functional copy.
- Use digits for counts and degrees: "3 files", "90-degree steps" ("90°" only in compact UI labels).
- Use "…" only on in-progress statuses. End other sentences with a period.
- Never use "upload" as a user action. State the privacy claim with "No uploads." or "nothing is uploaded"; file picking is "choose" or "open".

### Canonical terms

Use the canonical phrasing exact. Do not introduce variants.

| Concept | Canonical | Not |
| --- | --- | --- |
| File privacy | "Your files never leave your device." | "stay with you", "stay on your device", "keep the file with you" |
| Processing mechanism | "Everything runs in your browser. Nothing is uploaded." | "client-side", "browser-local", "server-free" |
| File types in prose | "PDFs and PNG or JPEG images" | "PNG/JPEG images", "PDFs and images" |
| File types in tight UI and allowlists | "PDFs and images", "PDF, PNG, or JPEG files" | "PNG/JPEG images" |
| The application | "the editor" | "the PDF editor", "the tool" |
| Pages kept for export | "exportable pages" | "active pages" |
| Removing a page from the export | "mark for deletion" / "restore" | "delete a page" |
| Output actions | "Download PDF", "Export PNG images", "Export started." | "build", "generate", "download started" |
| Compression scope | "one untouched PDF" | "untouched PDFs", "compressed PDFs" |

### Scope honesty

Copy may promise only what the Product Truth section of `AGENTS.md` lists as the current product surface. Update that section first, then code, then copy.

If two phrasings exist for one concept, one of them is a defect: add the canonical choice here, then replace the variant everywhere.

## Documentation

- `README.md` — user-facing current behavior only.
- `AGENTS.md` — product truth and agent behavior.
- `CONTRIBUTING.md` — this file.

Update `AGENTS.md` before changing product promises or scope, this file when the workflow changes, and `README.md` when public behavior changes.
