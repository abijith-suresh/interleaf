import { createSignal } from "solid-js";

interface Props {
  busy: boolean;
  statusMessage: string;
  onFileSelected: (file: File) => void;
}

export default function EditorUploader(props: Props) {
  const [isDragOver, setIsDragOver] = createSignal(false);
  let fileInput!: HTMLInputElement;

  function pickFile() {
    if (props.busy) return;
    fileInput.click();
  }

  function handleFile(file: File | undefined) {
    if (!file || props.busy) return;
    props.onFileSelected(file);
  }

  return (
    <div class="editor-uploader">
      <div class="editor-uploader-inner">
        <div class="editor-uploader-intro">
          <span class="editor-uploader-mark" aria-hidden="true" />
          <h2>Start with a PDF.</h2>
          <p>Arrange pages, then export.</p>
        </div>
        <button
          type="button"
          data-testid="editor-upload-dropzone"
          aria-busy={props.busy}
          aria-describedby="editor-upload-status"
          aria-label="Choose a PDF file or drop one here"
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
            if (props.busy) return;
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            if (props.busy) return;
            e.preventDefault();
            setIsDragOver(false);
            handleFile(e.dataTransfer?.files[0]);
          }}
        >
          <span class="editor-dropzone-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2h14v-2" />
            </svg>
          </span>
          <span class="editor-dropzone-copy">
            <strong>{props.busy ? "Preparing PDF…" : "Choose a PDF"}</strong>
            <span>{props.busy ? props.statusMessage : "or drop it here"}</span>
          </span>
        </button>
        <input
          ref={fileInput}
          data-testid="editor-upload-input"
          type="file"
          accept="application/pdf"
          name="pdf"
          aria-label="Choose a PDF"
          class="hidden"
          disabled={props.busy}
          onChange={(e) => {
            handleFile(e.currentTarget.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
        <p class="editor-upload-status" data-testid="editor-upload-status">
          {props.busy
            ? props.statusMessage
            : "Your file stays on your device. Nothing is uploaded."}
        </p>
      </div>
    </div>
  );
}
