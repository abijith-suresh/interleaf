# Interleaf

Interleaf is a PDF editor that runs entirely in your browser. Open PDFs and PNG or JPEG images together, review and shape their pages, fill forms, add or replace text, export images, unlock protected files, and compress one untouched PDF.

No uploads. No accounts. No tracking.

## Why

Online PDF tools are ad-infested and login-walled, and they usually want your documents uploaded to a server first. Interleaf gives the opposite guarantee structurally: Everything runs in your browser. Nothing is uploaded. Your files never leave your device.

## What it does

- Open one or more PDFs and PNG/JPEG images together, converting images into PDF pages
- Add more PDFs or PNG/JPEG images to an existing working set
- Remove a source file and its pages from the working set
- Extract selected pages into a new PDF
- Reorder pages with drag and drop
- Duplicate a supported page as an independently editable copy
- Rotate individual pages or selections in 90-degree steps
- Mark pages for deletion before export
- Unlock password-protected PDFs with an in-browser prompt
- Review pages one at a time with previous/next navigation and a compact filmstrip
- Zoom and pan page previews on desktop and mobile
- Losslessly compress one untouched PDF
- Export selected or unmarked pages as PNG images in a ZIP archive
- Render page thumbnails locally for inspection before export
- Fill existing text, checkbox, radio, and single-choice PDF form fields
- Fill flat or scanned forms with manually placed text and checkbox marks
- Use suggested blank boxes and underlines on supported vector PDFs
- Undo and redo saved edits, page changes, and added or removed files
- Add one line of text at a chosen position, drag its draft, and rotate it
- Replace supported original text runs within their original width

Use **Pages** to organize pages and **Document** to read them. On mobile, open **Tools** for
**Add text**, **Edit text**, or **Fill forms**; desktop shows these tools in the sidebar.
Tap the page to place text, highlighted text to replace it, or a form field to fill it.
Drag a new text draft to move it, and use its rotation control to change its orientation.
**Fill forms** uses embedded fields when available. On supported vector pages, tap a suggested
blank or checkbox to start a draft. Choose **Text** or **Mark** to place an answer anywhere;
**Mark** crosses a printed checkbox with an X. Adjust the draft and save it. Scanned pages
use manual placement. Suggestions do not create reusable interactive fields.
Use **Save & next** to move through supported fields. Drafts preview before applying; cancel them to discard
the draft. Use **Undo** and **Redo** in the header to correct saved changes.
Ctrl or Cmd+Z undoes a workspace change; Ctrl or Cmd+Shift+Z redoes it. Inside a text input,
undo stays with the draft. History lasts while this workspace is open and retains up to 32 changes.
Download your PDF directly from the editor.

The document editor downloads all exportable pages. In **Pages**, select pages to extract a subset.

Added and replacement text uses Helvetica and accepts basic Latin characters. Replacement changes PDF text objects directly. It does
not reflow paragraphs. Scanned pages, nested text, rotated text, and text with clipping or unsupported
styling cannot be replaced. Form scripts, XFA, signatures, and multi-select fields are unavailable.
Combining sources rebuilds supported fields with basic appearances and distinct source names.
Export documents with unsupported form widgets or selected choices that use separate export codes
individually to preserve their form data.

## Privacy contract

- All PDF processing runs in the browser. Documents are processed in memory and discarded when you close the tab.
- No uploads, no accounts, no analytics, no cookies.
- Fonts are self-hosted; the site loads no third-party resources.

You can verify all of this with your browser's network inspector.

## Stack

- [Astro 7](https://astro.build) for the site shell
- [SolidJS](https://www.solidjs.com/) for the editor interface
- [Tailwind CSS v4](https://tailwindcss.com) for styling
- [PDFium WASM](https://www.embedpdf.com/docs/pdfium/introduction) for PDF processing, rendering, forms, and text
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

[MIT](./LICENSE). PDFium and its bundled components retain their [license notices](./public/pdfium/LICENSE.pdfium).
