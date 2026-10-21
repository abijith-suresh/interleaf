# Agent Instructions — Interleaf

## Product truth

This section is the product source of truth. Update it before changing product scope, promises, or non-goals. Code and public copy follow this section, not the other way around.

### Core Promise

- Every operation runs entirely client-side, in the browser.
- Files never leave the device: no uploads, no server processing, no beacons.
- No accounts, signups, or login.
- No ads, tracking, analytics, or cookies.
- Keep the product honest about what is implemented today.

### Current Product Surface

The active product supports:

- merging multiple PDFs into one working set
- extracting selected pages into a new PDF
- reordering pages with drag and drop
- duplicating a page in the workspace, with independent rotation, deletion marking, and ordering
- rotating pages in 90-degree steps, individually or by selection
- marking pages for deletion before export
- undoing and redoing up to 32 changes in the current session: rotation, deletion marking or restoration, reordering, duplication, and source additions or removals after the first successful open
- retaining source history within a 48 MiB limit on unique inactive files, while keeping the newest change if it alone exceeds that limit
- keeping undo and redo available when the last source is removed
- unlocking password-protected PDFs with an in-browser prompt
- locally rendered page thumbnails for inspection before export
- organizing and reading in persistent Pages and Document views within one workspace
- reviewing pages one at a time with previous/next navigation and a compact filmstrip
- adding, selecting, editing, dragging, rotating, and deleting one-line printable basic Latin text in Document view, using Helvetica
- undoing and redoing saved text changes within the same session history
- including saved text in page previews, thumbnails, PDF downloads, and PNG exports
- filling supported visible, printable, embedded, unencrypted, single-line PDF text fields in Document view with printable basic Latin answers and Helvetica appearances
- keeping linked original text widgets on one answer, while duplicated logical pages have independent answers
- saving and clearing field answers, with session undo and redo, and including them in page previews, thumbnails, PDF downloads, and PNG exports
- enforcing inherited text length limits and rejecting answers that do not fit every linked widget
- manually adding, selecting, moving, resizing, rotating, and deleting vector checkmarks in Document view for flat or scanned forms
- undoing and redoing saved checkmark changes, and including saved checkmarks in page previews, thumbnails, PDF downloads, and PNG exports
- zooming page previews up to 4 times their fitted size, with pinch, drag, scroll, and keyboard panning
- losslessly compressing an untouched, single uploaded PDF in the browser
- exporting selected or active PDF pages as PNG images in a local ZIP archive
- opening one or more PDFs and PNG or JPEG images together at initial upload, with images converted to PDF pages in the browser
- adding one or more PDFs and PNG or JPEG images to an existing workspace, with images converted to PDF pages in the browser
- removing a source file and its pages from the workspace

These are the only current public product promises.

### Non-Goals

The product does not include, and must not gain without this section changing first:

- server-side PDF processing or uploads of any kind
- accounts, signups, sync, or collaboration
- automatic box detection, OCR, or original text replacement
- filling encrypted, multiline, password, file-selection, combed, rich-text, read-only, scripted, XFA, or signed forms, or non-text field types
- repairing exported AcroForm trees, validating form submission requirements, or promising that removing pages erases every associated answer
- ads, tracking, analytics, cookies, or fingerprinting
- unapproved speculative code kept only for possible future expansion
- public promises for features that are not implemented

## Documentation

- `README.md`: user-facing current behavior only.
- `CONTRIBUTING.md`: development workflow, commands, conventions, commits, and PR rules.
- `AGENTS.md`: product truth and agent behavior.

Do not advertise unimplemented features in any of them. Treat stale docs as defects: if product scope changes, update the Product Truth section of this file first, then code, then public copy.

How the app works is documented by the code and its tests, not by prose. Do not restate implementation details in docs; they rot.

## Agent workflow

- Branch from the latest `main` before starting changes.
- Never commit directly to `main`.
- Commit and PR titles must use Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`, or `build`.
- Before push, run `bun run verify`.
- Squash merge is the expected merge strategy.
- Open one focused PR for each coherent change.
- Independent PRs may be developed and opened in parallel. Stack or delay PRs that overlap in files or depend on another change.

Detailed workflow, hooks, commands, and CI behavior live in `CONTRIBUTING.md`.
