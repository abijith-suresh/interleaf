# Contributing

These rules apply to people and coding agents alike. Agents should also read [AGENTS.md](AGENTS.md), which defines the product scope.

## Setup

You need Bun and Node.js. `mise.toml` pins both versions and `.node-version` pins Node.js. With [mise](https://mise.jdx.dev):

```sh
mise install
bun install        # also installs the Git hooks
bun run dev        # http://localhost:4321
```

## Checks

```sh
bun run verify
```

This runs type-check, lint, format check, unit tests and the production build. `bun run lint:fix` and `bun run format` fix most lint and format errors.

Browser tests use Playwright against a production build:

```sh
bunx playwright install --with-deps chromium firefox webkit   # once per machine
bun run test:e2e:build   # build, then run the browser tests
bun run test:e2e         # reuse an existing build
```

Git hooks run on your machine:

- `pre-commit` runs Biome on staged files through lint-staged.
- `commit-msg` checks the message with commitlint.
- `pre-push` runs `bun run verify`.

On every pull request, CI runs `verify`, the browser tests in Chromium, Firefox and WebKit, a dependency review, and a PR title check. When qpdf files change, it also rebuilds the qpdf WebAssembly module. The `gate` check must pass before merge.

`bun run build:qpdf-wasm` needs Emscripten. You only need it if you change the qpdf build in `tools/qpdf-wasm`.

## Making a change

1. Branch from the latest `main`.
2. Keep each pull request to one focused change.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for commits and the PR title: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci` or `build`.
4. Run `bun run verify` before you push.
5. Open the pull request against `main`. Pull requests are squash merged.

release-please creates releases from the commits on `main`.

## Product rules

- Everything runs in the browser. Do not add uploads, server-side processing or requests to other servers.
- No accounts, analytics, tracking or cookies.
- Do not add or advertise features outside the scope in [AGENTS.md](AGENTS.md). Change its Product truth section first.

## PDF libraries

| Library | Used for |
| --- | --- |
| pdfjs-dist | Opening and reading files, the password prompt, previews, thumbnails and PNG export |
| pdf-lib | Writing every output: merge, extract, rotate, added text, checkmarks and field answers |
| qpdf (WebAssembly) | Decrypting encrypted files so pdf-lib can read them, and lossless compression |

Open an issue before adding another PDF engine. PDFium is on hold because copying pages with it loses inherited form-field data. Reconsider it only with an upstream fix, complete license notices for its bundled libraries, and a stable release.

## Code style

- Follow the existing Astro, Solid, TypeScript and Tailwind patterns. Biome enforces formatting and lint rules.
- Put unit tests in `__tests__` folders next to the code they test. They use Vitest with jsdom. Browser tests go in `tests/e2e`.
- Test behaviour, not internals. Compare an element with its resting state or another element instead of literal colour values.
- Design tokens live in `src/styles/global.css` and editor styles in `src/styles/editor.css`.
- Follow the [Cards](https://github.com/oliur/cards) structure with Interleaf's Evergreen palette: white surfaces on a green-tinted neutral canvas, evergreen ink, and the leaf green only for selection, focus, and Interleaf's own additions to a page.
- Document behaviour in code and tests, not in prose.

## Writing copy

- Use sentence case, short sentences, active voice and "you".
- Describe only what the product does today.
- Never call opening a file "upload". Use "open" or "choose".
- Use one phrasing per idea. For privacy, write "Your files never leave your device." or "Everything runs in your browser. Nothing is uploaded."
- No exclamation marks or hype words.
