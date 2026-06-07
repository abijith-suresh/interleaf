# Architecture — Interleaf

## High-Level Overview

```
Browser
├── Astro 6 (static site + SSR for OG images)
│   ├── Marketing pages (.astro)
│   │   ├── Home, Features, About, FAQ, Privacy, Terms
│   │   └── Shared chrome: Nav, Footer, BottomCTA, PageHeader, NumberedRow
│   └── Editor page (/app)
│       └── SolidJS island (client:only)
└── SolidJS Editor (client-side only)
    ├── PDFService — load, cache, render PDFs
    ├── PDFOperationsService — build, extract output PDFs
    ├── Controller — page state helpers
    └── Components — Editor, Sidebar, PageGrid, PageTile, PageCanvas, Uploader
```

## Stack

| Layer               | Technology                 |
| ------------------- | -------------------------- |
| Site framework      | Astro 6                    |
| Editor UI           | SolidJS                    |
| CSS                 | Tailwind CSS v4            |
| PDF rendering       | pdf.js (Mozilla)           |
| PDF manipulation    | pdf-lib                    |
| OG image generation | Satori + Resvg             |
| Package manager     | Bun                        |
| Tests               | Vitest (jsdom environment) |
| Language            | TypeScript                 |
| Linting             | ESLint + Prettier          |
| CI                  | GitHub Actions             |

## Directory Structure

```
src/
  components/
    app/                  SolidJS editor components
      Editor.tsx           Root editor — state, operations, layout
      EditorPageCanvas.tsx Lazy-rendered page thumbnail (IntersectionObserver)
      EditorPageGrid.tsx   Scrollable grid of page tiles
      EditorPageTile.tsx   Drag-and-drop page tile with selection state
      EditorSidebar.tsx    Desktop sidebar: actions, upload, export
      EditorUploader.tsx   Initial upload dropzone
    shared/               Astro shared chrome
      BottomCTA.astro
      Footer.astro
      Nav.astro
      NumberedRow.astro
      PageHeader.astro
  controllers/            Page-state logic (no DOM, no rendering)
    editor-page-state.ts  createPageStates, toggleSelection, remapAfterMove
  layouts/
    Layout.astro          Base HTML shell, meta tags, OG, fonts
  pages/
    index.astro           Homepage
    app.astro             Editor entry point
    features.astro        Feature list
    about.astro           About, tech stack, values
    faq.astro             FAQ
    privacy.astro         Privacy policy
    terms.astro           Terms of service
    og/[page].png.ts      Dynamic OG image endpoint
  scripts/
    scroll-animations.ts  IntersectionObserver scroll reveals
  services/
    pdf-service.ts        PDF load/unlock/render (PDFDocument + pdf.js)
    pdf-operations-service.ts  Build/extract output PDFs (pdf-lib)
  styles/
    global.css            Tailwind tokens, animations, shared utilities
    editor.css            Editor-only page tile styles
  types/
    interfaces.ts         PageState, PDFOperationResult, errors
  utils/
    download.ts           Blob-based file download
    password-prompt.ts    Imperative DOM modal for PDF unlock
    toast.ts              Custom event-based toast system
    transitions.ts        Astro View Transition config
  constants.ts            Magic numbers and strings
```

## Data Flow

### PDF Loading

```
User drops/selects file
  → Editor.loadPdfFile()
    → PDFService.loadPDF(file)
      → File.arrayBuffer()
      → PDFDocument.load(buffer)     [pdf-lib]
      → pdfjsLib.getDocument(data)   [pdf.js]
      → Cache in documentCache Map<File, LoadedPDFRecord>
      → Set activeFile
    → Editor creates PageState[] via controller
```

### Thumbnail Rendering

```
PageTile comes into viewport
  → IntersectionObserver fires
  → PDFService.renderPage(file, pageNum, canvas, scale, rotation)
    → Get cached pdfjsDocument for file
    → page.getViewport({ scale, rotation })
    → page.render({ canvasContext, viewport }).promise
```

### PDF Export (Download/Extract)

```
User clicks Download or Extract
  → PDFOperationsService.buildPDF(pages) or buildPDFFromSubset(pages, indices)
    → Filter out deleted pages
    → For each page: getOrLoadSourceDoc → copyPages → setRotation → addPage
    → outputDoc.save() → Uint8Array
  → downloadPDF(result)
    → Blob → ObjectURL → hidden <a> click
```

## Key Design Decisions

### File-keyed caching

PDFService and PDFOperationsService both cache by `File` reference. This allows multi-file sessions where thumbnails from different source PDFs render independently. The cache is cleared on session reset and component cleanup.

### Co-located tests

Tests live alongside their source at `src/**/__tests__/`. Vitest is configured with `jsdom` environment and globals enabled. Test files match `*.test.ts`.

### Controller/service split

- **Services**: Pure logic (PDF loading, rendering, building) — no DOM, no UI.
- **Controllers**: Stateless helper functions for page-state mutations — no side effects.
- **Components**: UI only, delegate to services and controllers.

### Imperative password prompt

The password modal is built imperatively (vanilla DOM) rather than as a SolidJS component. This avoids conditional rendering inside the editor tree and keeps the prompt available during any loading state.

### Toast system

Toasts use a `CustomEvent` bus (`interleaf:toast`). Utilities dispatch events; the Editor component listens and renders. This decouples toast triggers from the UI layer.
