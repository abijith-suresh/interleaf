# Interleaf

Interleaf is a fully client-side PDF editor for the core tasks people reach for most: merge, extract, reorder, rotate, delete, and unlock.

No uploads. No accounts. No tracking.

## Why

Online PDF tools are ad-infested and login-walled, and they usually want your documents uploaded to a server first. Interleaf gives the opposite guarantee structurally: every operation runs in your browser with `pdf-lib` and `pdf.js`, so your files never leave your device.

## What it does

- Merge multiple PDFs into one working set
- Extract selected pages into a new PDF
- Reorder pages with drag and drop
- Rotate individual pages or selections in 90-degree steps
- Mark pages for deletion before export
- Unlock password-protected PDFs with an in-browser prompt
- Render page thumbnails locally for inspection before export

## Privacy contract

- All PDF processing runs in the browser. Documents are processed in memory and discarded when you close the tab.
- No uploads, no accounts, no analytics, no cookies.
- Fonts are self-hosted; the site loads no third-party resources.

You can verify all of this with your browser's network inspector.

## Stack

- [Astro 7](https://astro.build) for the site shell
- [SolidJS](https://www.solidjs.com/) for the editor interface
- [Tailwind CSS v4](https://tailwindcss.com) for styling
- [pdf-lib](https://pdf-lib.js.org) and [pdf.js](https://mozilla.github.io/pdf.js/) for PDF processing and rendering
- [Vitest](https://vitest.dev/) for unit tests
- [Bun](https://bun.sh) via [mise](https://mise.jdx.dev) for package management and scripts

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

## Contributing

See `AGENTS.md` for product truth and the contribution workflow. Keep changes atomic and follow Conventional Commits. Preserve the browser-only privacy model: do not add uploads or server-side PDF handling.

## License

[MIT](./LICENSE)
