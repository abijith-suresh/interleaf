import { createSignal } from "solid-js";

interface Props {
  busy: boolean;
  statusMessage: string;
  onFilesSelected: (files: File[]) => void;
}

export default function EditorUploader(props: Props) {
  const [isDragOver, setIsDragOver] = createSignal(false);
  let fileInput!: HTMLInputElement;

  function pickFile() {
    if (props.busy) return;
    fileInput.click();
  }

  function handleFiles(files: File[]) {
    if (files.length === 0 || props.busy) return;
    props.onFilesSelected(files);
  }

  function preventBusyDrop(event: DragEvent) {
    if (!props.busy) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <section
      class="editor-uploader"
      aria-label="File upload"
      onDragOver={preventBusyDrop}
      onDrop={preventBusyDrop}
    >
      <div class="editor-uploader-inner">
        <div class="editor-uploader-intro">
          <h2>Open or create a PDF.</h2>
        </div>
        <button
          type="button"
          data-testid="editor-upload-dropzone"
          disabled={props.busy}
          aria-busy={props.busy}
          aria-describedby="editor-upload-status"
          aria-label="Choose PDF or image files, or drop them here"
          class={`editor-dropzone ${props.busy ? "is-busy" : ""} ${isDragOver() ? "is-drag-over" : ""}`}
          onClick={pickFile}
          onKeyDown={(e) => {
            if (props.busy) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pickFile();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (props.busy) return;
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            if (props.busy) return;
            handleFiles(Array.from(e.dataTransfer?.files ?? []));
          }}
        >
          <span class="editor-dropzone-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2h14v-2" />
            </svg>
          </span>
          <span class="editor-dropzone-copy">
            <strong>{props.busy ? "Preparing PDF…" : "Choose PDFs or PNG/JPEG images"}</strong>
            <span>{props.busy ? props.statusMessage : "or drop them here"}</span>
          </span>
        </button>
        <input
          ref={fileInput}
          data-testid="editor-upload-input"
          type="file"
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
          multiple
          name="pdf"
          aria-label="Choose PDF or image files"
          class="hidden"
          disabled={props.busy}
          onChange={(e) => {
            handleFiles(Array.from(e.currentTarget.files ?? []));
            e.currentTarget.value = "";
          }}
        />
        <p
          class="editor-upload-status"
          data-testid="editor-upload-status"
          role="status"
          aria-live="polite"
        >
          {props.statusMessage}
        </p>
      </div>
    </section>
  );
}
