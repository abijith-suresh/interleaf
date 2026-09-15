import { For } from "solid-js";
import EditorUploader from "./EditorUploader";

interface Props {
  busy: boolean;
  statusMessage: string;
  onFileSelected: (file: File) => void;
}

const workflows = [
  {
    number: "01",
    slug: "arrange",
    title: "Arrange pages",
    description: "Reorder, rotate, or mark pages for deletion before export.",
  },
  {
    number: "02",
    slug: "combine",
    title: "Combine PDFs",
    description: "Add more PDFs to one working set and export them together.",
  },
  {
    number: "03",
    slug: "extract",
    title: "Extract pages",
    description: "Select the pages you need and create a new PDF.",
  },
  {
    number: "04",
    slug: "unlock",
    title: "Unlock a protected PDF",
    description: "Enter its password in the browser, then continue editing locally.",
  },
] as const;

export default function EditorWorkflowStart(props: Props) {
  return (
    <div class="editor-start" data-testid="editor-workflow-shell">
      <section class="editor-start-copy" aria-labelledby="editor-start-title">
        <p class="editor-start-eyebrow">
          <span aria-hidden="true" /> Local PDF workspace
        </p>
        <h2 id="editor-start-title" class="editor-start-title">
          Make the pages behave.
        </h2>
        <p class="editor-start-description">
          Open a PDF, shape its pages, and export a clean working copy. Every task below uses the
          same focused editor.
        </p>
        <p class="editor-start-privacy">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2.5 16 5v4.4c0 3.6-2.4 6.7-6 8.1-3.6-1.4-6-4.5-6-8.1V5l6-2.5Z" />
            <path d="m7.2 10 1.8 1.8 3.8-4" />
          </svg>
          <span>Local by default. Nothing is uploaded.</span>
        </p>

        <section class="editor-start-tasks" aria-labelledby="editor-start-tasks-title">
          <div class="editor-start-section-heading">
            <p>Available now</p>
            <h3 id="editor-start-tasks-title">Edit and organize</h3>
          </div>
          <div class="editor-task-grid">
            <For each={workflows}>
              {(workflow) => (
                <a
                  class="editor-task-card"
                  data-testid={`editor-workflow-task-${workflow.slug}`}
                  href="#editor-upload-dropzone"
                >
                  <span class="editor-task-index" aria-hidden="true">
                    {workflow.number}
                  </span>
                  <span class="editor-task-copy">
                    <strong>{workflow.title}</strong>
                    <span>{workflow.description}</span>
                  </span>
                  <svg class="editor-task-arrow" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 10h11m-4-4 4 4-4 4" />
                  </svg>
                </a>
              )}
            </For>
          </div>
        </section>
      </section>

      <EditorUploader
        busy={props.busy}
        statusMessage={props.statusMessage}
        onFileSelected={props.onFileSelected}
      />
    </div>
  );
}
