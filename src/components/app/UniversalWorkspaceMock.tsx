import { For, Show, createMemo, createSignal } from "solid-js";

type PageKind = "pdf" | "image";

interface WorkspacePage {
  id: string;
  label: string;
  source: string;
  kind: PageKind;
  tone: "blue" | "yellow" | "green" | "rose";
}

const workspaceFiles = [
  { id: "brief", name: "project-brief.pdf", detail: "2 pages", pageId: "page-1" },
  { id: "screenshots", name: "screenshots", detail: "2 images", pageId: "page-3" },
] as const;

const workspacePages: WorkspacePage[] = [
  { id: "page-1", label: "Cover", source: "project-brief.pdf", kind: "pdf", tone: "blue" },
  { id: "page-2", label: "Brief", source: "project-brief.pdf", kind: "pdf", tone: "yellow" },
  { id: "page-3", label: "Dashboard", source: "screenshots", kind: "image", tone: "green" },
  { id: "page-4", label: "Settings", source: "screenshots", kind: "image", tone: "rose" },
];

const actionLabels = {
  rotate: "Rotate selected page",
  moveEarlier: "Move selected page earlier",
  moveLater: "Move selected page later",
  remove: "Remove selected page",
} as const;

export default function UniversalWorkspaceMock() {
  const [selectedPageId, setSelectedPageId] = createSignal("page-3");
  const [statusMessage, setStatusMessage] = createSignal("Page 3 selected");

  const selectedPage = createMemo(() =>
    workspacePages.find((page) => page.id === selectedPageId())
  );

  function selectPage(page: WorkspacePage) {
    setSelectedPageId(page.id);
    setStatusMessage(`${page.label} selected`);
  }

  function selectFile(pageId: string) {
    const page = workspacePages.find((item) => item.id === pageId);
    if (page) selectPage(page);
  }

  function announceAction(action: keyof typeof actionLabels) {
    const page = selectedPage();
    if (!page) return;
    setStatusMessage(`${actionLabels[action]} would apply to ${page.label}`);
  }

  return (
    <div class="workspace-mock" data-testid="universal-workspace-mock">
      <header class="workspace-mock-header">
        <a class="workspace-mock-brand" href="/" translate="no">
          <span aria-hidden="true" />
          interleaf
        </a>
        <span class="workspace-mock-badge">Concept preview</span>
        <div class="workspace-mock-header-actions">
          <button
            type="button"
            class="workspace-mock-quiet-button"
            onClick={() => setStatusMessage("New workspace would start here")}
          >
            New workspace
          </button>
          <a class="workspace-mock-exit" href="/app">
            Exit
          </a>
        </div>
      </header>

      <div class="workspace-mock-notice" role="note">
        <span class="workspace-mock-notice-mark" aria-hidden="true" />
        <span>This is a visual concept for one local working set of PDFs and images.</span>
      </div>

      <main class="workspace-mock-main">
        <aside class="workspace-mock-files" aria-labelledby="workspace-files-title">
          <div class="workspace-mock-panel-heading">
            <div>
              <p class="workspace-mock-eyebrow">Working set</p>
              <h1 id="workspace-files-title">Untitled workspace</h1>
            </div>
            <button
              type="button"
              class="workspace-mock-add"
              aria-label="Add files to workspace"
              onClick={() => setStatusMessage("Add files would open here")}
            >
              +
            </button>
          </div>
          <p class="workspace-mock-summary">2 files · 4 pages</p>

          <div class="workspace-mock-file-list">
            <For each={workspaceFiles}>
              {(file) => (
                <button
                  type="button"
                  class="workspace-mock-file"
                  classList={{ "is-active": selectedPage()?.source === file.name }}
                  aria-pressed={selectedPage()?.source === file.name}
                  onClick={() => selectFile(file.pageId)}
                >
                  <span class="workspace-mock-file-icon" aria-hidden="true">
                    {file.name.endsWith(".pdf") ? "PDF" : "IMG"}
                  </span>
                  <span class="workspace-mock-file-copy">
                    <strong>{file.name}</strong>
                    <span>{file.detail}</span>
                  </span>
                  <span class="workspace-mock-file-dots" aria-hidden="true">
                    ···
                  </span>
                </button>
              )}
            </For>
          </div>

          <div class="workspace-mock-file-footer">
            <p>Everything stays in this browser.</p>
            <span class="workspace-mock-local-status">
              <i aria-hidden="true" /> Local only
            </span>
          </div>
        </aside>

        <section class="workspace-mock-canvas" aria-labelledby="workspace-pages-title">
          <div class="workspace-mock-canvas-header">
            <div>
              <p class="workspace-mock-eyebrow">Workspace</p>
              <h2 id="workspace-pages-title">Pages</h2>
            </div>
            <div class="workspace-mock-canvas-controls">
              <span class="workspace-mock-count">4 pages</span>
              <button
                type="button"
                class="workspace-mock-zoom"
                onClick={() => setStatusMessage("Zoom controls would live here")}
              >
                100%
              </button>
            </div>
          </div>

          <ul class="workspace-mock-page-grid" aria-label="Workspace pages">
            <For each={workspacePages}>
              {(page, index) => (
                <li>
                  <button
                    type="button"
                    class="workspace-mock-page"
                    classList={{ "is-selected": selectedPageId() === page.id }}
                    aria-label={`Select page ${index() + 1}, ${page.label} from ${page.source}`}
                    aria-pressed={selectedPageId() === page.id}
                    onClick={() => selectPage(page)}
                  >
                    <span class="workspace-mock-page-number">
                      {String(index() + 1).padStart(2, "0")}
                    </span>
                    <span
                      class={`workspace-mock-thumbnail workspace-mock-thumbnail-${page.kind} workspace-mock-tone-${page.tone}`}
                      aria-hidden="true"
                    >
                      <Show
                        when={page.kind === "pdf"}
                        fallback={
                          <span class="workspace-mock-image-art">
                            <i />
                            <b />
                            <em />
                          </span>
                        }
                      >
                        <span class="workspace-mock-pdf-kicker">PDF</span>
                        <span class="workspace-mock-pdf-title">{page.label}</span>
                        <span class="workspace-mock-pdf-lines">
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                      </Show>
                    </span>
                    <span class="workspace-mock-page-caption">
                      <strong>{page.label}</strong>
                      <span>{page.source}</span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>

          <button
            type="button"
            class="workspace-mock-add-pages"
            onClick={() => setStatusMessage("Add files would open here")}
          >
            <span aria-hidden="true">+</span>
            Add files to workspace
          </button>
          <section class="workspace-mock-action-bar" aria-labelledby="workspace-actions-title">
            <div class="workspace-mock-selection">
              <p class="workspace-mock-eyebrow">Selection</p>
              <strong id="workspace-actions-title">
                {selectedPage() ? `${selectedPage()?.label} selected` : "No page selected"}
              </strong>
            </div>
            <div class="workspace-mock-action-list">
              <button
                type="button"
                disabled={!selectedPage()}
                onClick={() => announceAction("rotate")}
              >
                <span>Rotate</span>
                <b>R</b>
              </button>
              <button
                type="button"
                disabled={!selectedPage()}
                onClick={() => announceAction("moveEarlier")}
              >
                <span>Move earlier</span>
                <b>↑</b>
              </button>
              <button
                type="button"
                disabled={!selectedPage()}
                onClick={() => announceAction("moveLater")}
              >
                <span>Move later</span>
                <b>↓</b>
              </button>
              <button
                type="button"
                class="is-danger"
                disabled={!selectedPage()}
                onClick={() => announceAction("remove")}
              >
                <span>Remove page</span>
                <b>⌫</b>
              </button>
            </div>
            <div class="workspace-mock-export">
              <span>4 pages · 2 source files</span>
              <button
                type="button"
                onClick={() => setStatusMessage("Export would create a PDF from this working set")}
              >
                Export PDF <span aria-hidden="true">↗</span>
              </button>
            </div>
          </section>
        </section>
      </main>

      <p class="workspace-mock-status" role="status" aria-live="polite">
        {statusMessage()}
      </p>
    </div>
  );
}
