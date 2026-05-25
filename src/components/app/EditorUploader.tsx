import { createSignal } from "solid-js";

interface Props {
  busy: boolean;
  statusMessage: string;
  onFileSelected: (file: File) => void;
}

export default function EditorUploader(props: Props) {
  const [isDragOver, setIsDragOver] = createSignal(false);
  // eslint-disable-next-line no-unassigned-vars
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
    <div class="flex-1 flex items-center justify-center min-h-0">
      <div class="w-full max-w-lg px-6">
        <div
          data-testid="editor-upload-dropzone"
          role="button"
          tabIndex={0}
          aria-busy={props.busy}
          aria-label="Click or drag a PDF file here to upload"
          class={`border-2 border-dashed transition-colors py-20 text-center ${
            props.busy
              ? "border-primary bg-hover cursor-wait"
              : `cursor-pointer ${isDragOver() ? "border-primary bg-hover" : "border-border hover:border-primary"}`
          } interactive-focus`}
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
          <p class="font-display text-4xl text-primary mb-2">
            {props.busy ? "Working..." : "Drop PDF here"}
          </p>
          <p class="text-micro uppercase tracking-label text-muted">
            {props.busy ? props.statusMessage : "or click to browse"}
          </p>
        </div>
        <input
          ref={fileInput}
          data-testid="editor-upload-input"
          type="file"
          accept="application/pdf"
          class="hidden"
          disabled={props.busy}
          onChange={(e) => {
            handleFile(e.currentTarget.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
        <p
          class="text-muted text-xs mt-3 text-center min-h-[1em]"
          data-testid="editor-upload-status"
        >
          {props.busy ? props.statusMessage : "Private by default. Files stay in your browser."}
        </p>
      </div>
    </div>
  );
}
