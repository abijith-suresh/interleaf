# Interleaf

Interleaf is a fully client-side PDF editor for the core tasks people reach for most: merge, extract, reorder, rotate, delete, and unlock. Every operation runs in your browser with `pdf-lib` and `pdf.js`, so your files never leave your device.

## Product Scope

- Merge multiple PDFs into one working set
- Extract selected pages into a new PDF
- Reorder pages with drag and drop
- Rotate individual pages or selections in 90 degree steps
- Mark pages for deletion before export
- Unlock password-protected PDFs with an in-browser prompt
- Render page thumbnails locally with pdf.js for inspection before export

## Stack

- [Astro 6](https://astro.build) for the site shell and content pages
- [SolidJS](https://www.solidjs.com/) for the editor interface
- [Tailwind CSS v4](https://tailwindcss.com) for styling
- [pdf-lib](https://pdf-lib.js.org) and [pdf.js](https://mozilla.github.io/pdf.js/) for PDF processing/rendering
- [Vitest](https://vitest.dev/) for unit tests
- [Bun](https://bun.sh) for package management and scripts

## Development

```sh
bun install
bun run dev
```

The app runs at `http://localhost:4321` by default.

## Quality Checks

```sh
bun run verify
```

Or run the individual steps:

```sh
bun run type-check
bun run lint
bun run format:check
bun run test
bun run build
```

## Project Structure

```text
src/
  components/app/      Solid editor UI and page tiles/canvases
  components/shared/   Shared marketing-site chrome
  controllers/         Editor page-state helpers and orchestration logic
  fonts/               Self-hosted application assets
  layouts/             Shared page layout and SEO tags
  pages/               Marketing, legal, editor, and OG routes
  services/            PDF load, render, and build services
  styles/              Global styles and motion primitives
  utils/               Download, password, toast, and transition helpers
tests/
  unit/                Unit tests for services, controllers, and utilities
```

## Release Notes

- Current canonical domain target: `https://interleaf.page`
- Current GitHub repository: `https://github.com/abijith-suresh/interleaf`
- License: [MIT](./LICENSE)

## Contributing

- Open an issue for bugs, polish work, or roadmap ideas
- Keep changes atomic and follow Conventional Commits
- Preserve the browser-only privacy model: do not add uploads or server-side PDF handling
- Run `bun run verify` before opening a PR
