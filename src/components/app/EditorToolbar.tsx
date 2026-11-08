import Wordmark from "../shared/Wordmark";
import EditorHistoryControls from "./EditorHistoryControls";
import EditorButton from "./ui/EditorButton";
import EditorIcon from "./ui/EditorIcon";
import { EditorMenu, EditorMenuItem } from "./ui/EditorMenu";
import EditorOverflow from "./ui/EditorOverflow";
import { createRovingToolbar } from "./ui/roving-toolbar";

interface Props {
  base: string;
  view: "pages" | "document";
  pageCount: number;
  pageCountLabel: string;
  exportableCount: number;
  filesLabel: string;
  filesOpen: boolean;
  busy: boolean;
  busyLabel: string;
  undoLabel?: string;
  redoLabel?: string;
  historyUnavailable: boolean;
  historyBlockedReason?: string;
  compressionAvailable: boolean;
  compressionDisabledReason: string;
  filesButtonRef: (element: HTMLButtonElement) => void;
  moreButtonRef: (element: HTMLButtonElement) => void;
  downloadButtonRef: (element: HTMLButtonElement) => void;
  onViewChange: (view: "pages" | "document") => void;
  onAddFiles: () => void;
  onOpenFiles: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDownload: () => void;
  onExportImages: () => void;
  onCompress: () => void;
}

export default function EditorToolbar(props: Props) {
  let toolbar!: HTMLDivElement;
  createRovingToolbar(() => toolbar);

  const noPages = () => props.exportableCount === 0;
  const downloadLabel = () =>
    noPages() ? "No exportable pages to download" : "Download a PDF with all exportable pages";
  const imagesLabel = () =>
    noPages()
      ? "No exportable pages to export as images"
      : "Export all exportable pages as PNG images in a ZIP archive";
  const compressionDisabled = () => noPages() || !props.compressionAvailable;
  const compressionLabel = () =>
    compressionDisabled() ? props.compressionDisabledReason : "Compress the original PDF";

  return (
    <div
      ref={toolbar}
      role="toolbar"
      aria-label="Editor"
      data-testid="editor-toolbar"
      class="editor-toolbar"
    >
      <div class="editor-toolbar-start">
        <a
          href={props.base}
          class="editor-exit editor-exit-row"
          aria-label="Exit editor"
          title="Exit editor"
          data-testid="editor-exit-link"
        >
          <EditorIcon name="back" />
          <span class="editor-exit-brand" translate="no">
            <Wordmark />
          </span>
        </a>
        <fieldset class="editor-view-nav" aria-label="Workspace views">
          <EditorButton
            data-testid="editor-pages-view-button"
            data-view="pages"
            aria-label="Pages"
            aria-pressed={props.view === "pages"}
            aria-controls="editor-workspace-content"
            onClick={() => props.onViewChange("pages")}
            icon="pages"
          >
            <span class="editor-view-label">Pages</span>
          </EditorButton>
          <EditorButton
            data-testid="editor-document-view-button"
            aria-label="Document"
            aria-disabled={props.pageCount === 0}
            data-view="document"
            aria-pressed={props.view === "document"}
            aria-controls="editor-workspace-content"
            onClick={() => props.onViewChange("document")}
            icon="document"
          >
            <span class="editor-view-label">Document</span>
          </EditorButton>
        </fieldset>
      </div>

      <div class="editor-toolbar-middle">
        <EditorOverflow
          id="editor-more-actions"
          label="More actions"
          triggerTestId="editor-more-button"
          ref={props.moreButtonRef}
          class="editor-toolbar-more"
        >
          <EditorButton
            data-testid="editor-add-pdf-button"
            aria-label="Add PDFs or images"
            title="Add PDFs or images"
            class="editor-toolbar-action"
            variant="plain"
            onClick={props.onAddFiles}
            disabled={props.busy}
            icon="plus"
          >
            <span class="editor-toolbar-label">Add files</span>
          </EditorButton>
          <EditorButton
            ref={props.filesButtonRef}
            data-testid="editor-files-button"
            aria-label={props.filesLabel}
            aria-controls="editor-files-dialog"
            aria-expanded={props.filesOpen}
            title={props.filesLabel}
            class="editor-toolbar-action"
            variant="plain"
            onClick={props.onOpenFiles}
            disabled={props.busy || props.pageCount === 0}
            icon="files"
          >
            <span class="editor-toolbar-label">Files</span>
          </EditorButton>
          <a href={props.base} class="editor-exit editor-exit-overflow" aria-label="Exit editor">
            <EditorIcon name="back" />
            <span>Exit editor</span>
          </a>
        </EditorOverflow>
        <span class="editor-toolbar-divider" aria-hidden="true" />
        <EditorHistoryControls
          undoLabel={props.undoLabel}
          redoLabel={props.redoLabel}
          unavailable={props.historyUnavailable}
          blockedReason={props.historyBlockedReason}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
        />
      </div>

      <div class="editor-toolbar-end">
        <span class="editor-page-count" data-testid="editor-page-count">
          {props.pageCountLabel}
        </span>
        <EditorMenu
          id="editor-download-menu"
          label="Download"
          ariaLabel="Download options"
          menuLabel="Download options"
          testId="editor-download-menu-button"
          menuTestId="editor-download-menu"
          variant="primary"
          icon="open"
          class="editor-download-menu"
          busy={props.busy}
          busyLabel={props.busyLabel}
          ref={props.downloadButtonRef}
          header={<p class="editor-menu-caption">{props.pageCountLabel}</p>}
        >
          <EditorMenuItem
            testId="editor-download-button"
            label="Download PDF"
            ariaLabel={downloadLabel()}
            hint={noPages() ? "No exportable pages" : undefined}
            disabled={noPages()}
            onSelect={props.onDownload}
          />
          <EditorMenuItem
            testId="editor-export-images-button"
            label="Export PNG images"
            ariaLabel={imagesLabel()}
            hint={noPages() ? "No exportable pages" : "ZIP archive"}
            disabled={noPages()}
            onSelect={props.onExportImages}
          />
          <EditorMenuItem
            testId="editor-compress-button"
            label="Compress original PDF"
            ariaLabel={compressionLabel()}
            hint={compressionDisabled() ? props.compressionDisabledReason : undefined}
            disabled={compressionDisabled()}
            onSelect={props.onCompress}
          />
        </EditorMenu>
      </div>
    </div>
  );
}
