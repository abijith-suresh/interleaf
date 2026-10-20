# Interleaf

Interleaf is a PDF editor that runs entirely in your browser. Open PDFs and PNG or JPEG images together, review and shape their pages, export images, unlock protected files, and compress one untouched PDF.

No uploads. No accounts. No tracking.

## Why

Online PDF tools are ad-infested and login-walled, and they usually want your documents uploaded to a server first. Interleaf gives the opposite guarantee structurally: every operation runs in your browser with `pdf-lib`, `pdf.js`, and qpdf where applicable, so your files never leave your device.

## What it does

- Open one or more PDFs and PNG/JPEG images together, converting images into PDF pages
- Add more PDFs or PNG/JPEG images to an existing working set
- Remove a source file and its pages from the working set
- Extract selected pages into a new PDF
- Reorder pages with drag and drop
- Duplicate a page, then rotate, mark, or reorder each copy independently
- Rotate individual pages or selections in 90-degree steps
- Mark pages for deletion before export
- Undo or redo up to 32 page and source changes after your first successful open, even in an empty workspace.
- Source history retains up to 48 MiB of unique inactive files. The newest change stays available if it alone exceeds this limit.
- Unlock password-protected PDFs with an in-browser prompt
- Switch between Pages to organize and Document to read with navigation, zoom, and a compact filmstrip
- Add one-line text in Document view, using Helvetica. Place, drag, resize, rotate, edit, or delete your added text.
- Saved text appears in previews, thumbnails, PDF downloads, and PNG exports. Use session undo and redo for saved text changes.
- Keep page selection and export scope when switching views
- Zoom previews up to 4 times their fitted size. Pan with touch, drag, scrollbars, or arrow keys in the preview.
- Losslessly compress one untouched PDF
- Export selected or unmarked pages as PNG images in a ZIP archive
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
- [fflate](https://github.com/101arrowz/fflate) for local ZIP packaging
- [qpdf](https://qpdf.readthedocs.io/) compiled to WebAssembly for lossless PDF compression
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
