import { onCleanup, onMount } from "solid-js";
import Wordmark from "../shared/Wordmark";
import EditorHistoryControls from "./EditorHistoryControls";
import EditorButton from "./ui/EditorButton";
import EditorIcon from "./ui/EditorIcon";
import { EditorMenu, EditorMenuItem } from "./ui/EditorMenu";
import EditorOverflow from "./ui/EditorOverflow";
import { createRovingToolbar } from "./ui/roving-toolbar";
import { attachSegmentIndicator } from "./ui/segment-indicator";

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
  let viewNav!: HTMLFieldSetElement;
  let viewIndicator!: HTMLSpanElement;
  onMount(() => onCleanup(attachSegmentIndicator(viewNav, viewIndicator)));
  let toolbar!: HTMLDivElement;
  createRovingToolbar(() => toolbar);

  const noPages = () => props.exportableCount === 0;
  const downloadLabel = () => (noPages() ? "Download PDF. No pages to export." : "Download PDF");
  const imagesLabel = () =>
    noPages() ? "Export PNG. No pages to export." : "Export PNG as a ZIP archive";
  const compressionDisabled = () => noPages() || !props.compressionAvailable;
  const compressionLabel = () =>
    compressionDisabled() ? `Compress PDF. ${props.compressionDisabledReason}.` : "Compress PDF";

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
          class="editor-button editor-button-plain editor-exit editor-exit-row"
          aria-label="Back to Interleaf"
          title="Back to Interleaf"
          data-testid="editor-exit-link"
        >
          <EditorIcon name="back" />
          <span class="editor-exit-brand" translate="no">
            <Wordmark />
          </span>
        </a>
        <fieldset ref={viewNav} class="editor-view-nav" aria-label="Views">
          <span ref={viewIndicator} class="editor-segment-indicator" aria-hidden="true" />
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
        <EditorButton
          data-testid="editor-add-pdf-quick-button"
          aria-label="Add files"
          title="Add files"
          class="editor-toolbar-add-quick"
          variant="plain"
          onClick={props.onAddFiles}
          disabled={props.busy}
          icon="plus"
        />
        <EditorOverflow
          id="editor-more-actions"
          label="More actions"
          triggerTestId="editor-more-button"
          ref={props.moreButtonRef}
          class="editor-toolbar-more"
        >
          <EditorButton
            data-testid="editor-add-pdf-button"
            aria-label="Add files"
            title="Add files"
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
          <a
            href={props.base}
            class="editor-button editor-button-plain editor-exit editor-exit-overflow"
          >
            <EditorIcon name="back" />
            <span>Back</span>
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
            hint={noPages() ? "No pages to export" : undefined}
            disabled={noPages()}
            onSelect={props.onDownload}
          />
          <EditorMenuItem
            testId="editor-export-images-button"
            label="Export PNG"
            ariaLabel={imagesLabel()}
            hint={noPages() ? "No pages to export" : "ZIP archive"}
            disabled={noPages()}
            onSelect={props.onExportImages}
          />
          <EditorMenuItem
            testId="editor-compress-button"
            label="Compress PDF"
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
