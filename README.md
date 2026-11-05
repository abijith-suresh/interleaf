# Interleaf

Interleaf is a PDF editor that runs entirely in your browser. Open PDFs and PNG or JPEG images together, review and shape their pages, export images, unlock protected files, and compress one untouched PDF.

No uploads. No accounts. No tracking.

## Why

Online PDF tools are ad-infested and login-walled, and they usually want your documents uploaded to a server first. Interleaf gives the opposite guarantee: every operation runs in your browser, so your files never leave your device.

## What it does

- Open one or more PDFs and PNG or JPEG images together, converting images into PDF pages
- Add more PDFs and PNG or JPEG images to an existing working set
- Remove a source file and its pages from the working set
- Extract selected pages into a new PDF
- Reorder pages with drag and drop
- Duplicate a page, then rotate, mark, or reorder each copy independently
- Rotate individual pages or selections in 90-degree steps
- Mark pages for deletion before export
- Undo or redo up to 32 saved changes in the current session, including page, source, text, checkmark, and supported field edits. History starts after your first successful open and remains available in an empty workspace.
- Source history retains up to 48 MiB of unique inactive files. The newest change stays available if it alone exceeds this limit.
- Unlock password-protected PDFs with an in-browser prompt
- Switch between Pages to organize and Document to read with navigation, zoom, and a compact filmstrip
- Add one-line printable basic Latin text in Document view, using Helvetica. Select, edit, drag, rotate, or delete your added text.
- Add manual checkmarks to flat or scanned forms in Document view. Move, resize, rotate, or delete each checkmark.
- Saved text and checkmarks appear in previews, thumbnails, PDF downloads, and PNG exports, and support session undo and redo.
- Fill supported visible, printable, embedded, unencrypted, single-line text fields in Document view. Use printable basic Latin text; answers use Helvetica, respect inherited length limits, and must fit every linked widget.
- Linked original text widgets share an answer. Duplicated pages keep independent answers. Saved answers support session undo and redo and appear in previews, PDF downloads, and PNG exports.
- Encrypted, read-only, multiline, password, file-selection, combed, rich-text, scripted, XFA, and signed forms are unavailable for embedded filling. Non-text field types remain read-only. Use manual text and checkmarks for flat or scanned forms.
- Completed downloads keep the current export behavior; the editor does not repair editable form trees or validate submission requirements.
- Zoom previews up to 4 times their fitted size. Pan with touch, drag, scrollbars, or arrow keys in the preview.
- Losslessly compress one untouched PDF
- Export selected or exportable pages as PNG images in a ZIP archive
- Render page thumbnails locally for inspection before export

## Privacy contract

- All PDF processing runs in the browser. Documents are processed in memory and discarded when you close the tab.
- No uploads, no accounts, no analytics, no cookies.
- Fonts are self-hosted; the site loads no third-party resources. A security policy tells the browser to block connections to other sites.
- The static host receives standard request metadata, such as IP address and user agent, when a page loads. Interleaf does not use it, and it never includes your files.

You can check in your browser's network inspector that no file data is sent.

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

See `AGENTS.md` for product truth and `CONTRIBUTING.md` for the development workflow. Keep changes atomic and follow Conventional Commits. Preserve the browser-only privacy model: do not add uploads or server-side PDF handling.

## License

[MIT](./LICENSE)
