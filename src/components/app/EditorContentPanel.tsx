import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type {
  PDFContentEdit,
  PDFFormField,
  PDFPageContent,
  PDFTextRun,
} from "../../services/pdfium/protocol";
import type { PageState } from "../../types/interfaces";

interface Props {
  page: PageState;
  runtime: PDFRuntime;
  onChange: (file: File) => void;
  onBusy: (busy: boolean) => void;
}

export default function EditorContentPanel(props: Props) {
  const [mode, setMode] = createSignal<"add" | "replace" | "forms">("add");
  const [content, setContent] = createSignal<PDFPageContent>();
  const [run, setRun] = createSignal<PDFTextRun>();
  const [text, setText] = createSignal("");
  const [fontSize, setFontSize] = createSignal(14);
  const [left, setLeft] = createSignal(36);
  const [top, setTop] = createSignal(36);
  const [width, setWidth] = createSignal(200);
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  let generation = 0;
  let disposed = false;

  createEffect(() => {
    const page = props.page;
    void page.contentRevision;
    const current = ++generation;
    setContent(undefined);
    setRun(undefined);
    setText("");
    setMessage("");
    setLoading(true);
    void props.runtime
      .runPromise(
        PDFProcessing.use((service) =>
          service.getPageContent(page.sourceFile, page.sourcePageNumber)
        )
      )
      .then(
        (next) => {
          if (current === generation && !disposed) {
            setContent(next);
            setLoading(false);
          }
        },
        (error) => {
          if (current === generation && !disposed) {
            setMessage(error instanceof Error ? error.message : "Could not inspect page.");
            setLoading(false);
          }
        }
      );
  });

  onCleanup(() => {
    disposed = true;
    generation++;
  });

  async function apply(edit: PDFContentEdit) {
    if (busy() || loading()) return;
    const page = props.page;
    setBusy(true);
    props.onBusy(true);
    setMessage("");
    try {
      await props.runtime.runPromise(
        PDFProcessing.use((service) =>
          service.editPage(page.sourceFile, page.sourcePageNumber, edit)
        )
      );
      props.onChange(page.sourceFile);
      if (!disposed) setMessage("Change applied. Download PDF to save it.");
    } catch (error) {
      if (!disposed) setMessage(error instanceof Error ? error.message : "Could not apply change.");
    } finally {
      if (!disposed) setBusy(false);
      props.onBusy(false);
    }
  }

  function selectRun(selected: PDFTextRun) {
    setRun(selected);
    setText(selected.text);
    setMessage("");
  }
  function submitText(event: SubmitEvent) {
    event.preventDefault();
    const selected = run();
    if (mode() === "replace" && selected)
      void apply({
        kind: "replace",
        index: selected.index,
        text: text(),
        expectedText: selected.text,
      });
    else if (mode() === "add")
      void apply({
        kind: "add",
        text: text(),
        x: left(),
        y: (content()?.height ?? 0) - top() - fontSize(),
        width: width(),
        fontSize: fontSize(),
      });
  }

  return (
    <section class="editor-content-panel" aria-label="Page content">
      <fieldset class="editor-content-tabs" aria-label="Content tools">
        <For
          each={[
            { id: "add" as const, label: "Add text" },
            { id: "replace" as const, label: "Edit text" },
            { id: "forms" as const, label: "Fill forms" },
          ]}
        >
          {(tool) => (
            <button
              type="button"
              aria-pressed={mode() === tool.id}
              disabled={busy()}
              onClick={() => {
                setMode(tool.id);
                setRun(undefined);
                setText("");
                setMessage("");
              }}
            >
              {tool.label}
            </button>
          )}
        </For>
      </fieldset>
      <Show when={!loading()} fallback={<p role="status">Reading page…</p>}>
        <Show when={content()}>
          <Show
            when={mode() === "forms"}
            fallback={
              <form onSubmit={submitText}>
                <Show when={mode() === "replace"}>
                  <p>Select a text run. Change a word or the whole line.</p>
                  <div class="editor-content-runs">
                    <For
                      each={content()?.text}
                      fallback={<p>No supported text runs on this page.</p>}
                    >
                      {(item) => (
                        <button
                          type="button"
                          disabled={!item.editable || busy()}
                          aria-pressed={run()?.index === item.index}
                          title={item.reason ?? item.text}
                          onClick={() => selectRun(item)}
                        >
                          {item.text || "Empty text"}
                        </button>
                      )}
                    </For>
                  </div>
                  <p class="editor-content-note">
                    Replacement must fit the original width. Scanned pages and nested text are
                    unavailable.
                  </p>
                </Show>
                <label>
                  Text
                  <input
                    aria-label="Text"
                    type="text"
                    value={text()}
                    maxLength={1000}
                    disabled={busy() || (mode() === "replace" && !run())}
                    onInput={(event) => setText(event.currentTarget.value)}
                  />
                </label>
                <p class="editor-content-note">
                  Helvetica fallback. One line of basic Latin text. No automatic reflow.
                </p>
                <Show when={mode() === "add"}>
                  <p class="editor-content-note">
                    Position in points from the original page’s top left.
                  </p>
                  <div class="editor-content-position">
                    <label>
                      Left
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={left()}
                        onInput={(event) => setLeft(event.currentTarget.valueAsNumber)}
                      />
                    </label>
                    <label>
                      Top
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={top()}
                        onInput={(event) => setTop(event.currentTarget.valueAsNumber)}
                      />
                    </label>
                    <label>
                      Width
                      <input
                        type="number"
                        min="1"
                        value={width()}
                        onInput={(event) => setWidth(event.currentTarget.valueAsNumber)}
                      />
                    </label>
                    <label>
                      Font size
                      <input
                        type="number"
                        min="6"
                        max="144"
                        value={fontSize()}
                        onInput={(event) => setFontSize(event.currentTarget.valueAsNumber)}
                      />
                    </label>
                  </div>
                </Show>
                <button
                  class="editor-content-apply"
                  type="submit"
                  disabled={busy() || !text() || (mode() === "replace" && !run())}
                >
                  {busy() ? "Applying…" : mode() === "add" ? "Add text" : "Replace text"}
                </button>
              </form>
            }
          >
            <p>Fill existing fields, then download your PDF.</p>
            <For each={content()?.fields} fallback={<p>No form fields on this page.</p>}>
              {(field) => (
                <FormControl
                  field={field}
                  busy={busy()}
                  onApply={(value) => void apply({ kind: "form", index: field.index, value })}
                />
              )}
            </For>
            <p class="editor-content-note">
              Signatures, XFA, calculations, and multi-select fields are unavailable.
            </p>
          </Show>
        </Show>
      </Show>
      <p class="editor-content-message" role="status" aria-live="polite">
        {message()}
      </p>
    </section>
  );
}

function FormControl(props: {
  field: PDFFormField;
  busy: boolean;
  onApply: (value: string) => void;
}) {
  const [value, setValue] = createSignal(
    props.field.options[props.field.selectedOption] ?? props.field.value
  );
  const name = () => props.field.name || `Field ${props.field.index + 1}`;
  const disabled = () => props.busy || props.field.readOnly;
  return (
    <form
      class="editor-content-field"
      onSubmit={(event) => {
        event.preventDefault();
        props.onApply(value());
      }}
    >
      <Show
        when={[2, 3].includes(props.field.type)}
        fallback={
          <>
            <label>
              {name()}
              <Show
                when={[4, 5].includes(props.field.type) && !(props.field.flags & (1 << 18))}
                fallback={
                  <input
                    type={props.field.flags & (1 << 13) ? "password" : "text"}
                    value={value()}
                    disabled={disabled()}
                    onInput={(event) => setValue(event.currentTarget.value)}
                  />
                }
              >
                <select
                  value={value()}
                  disabled={disabled()}
                  onChange={(event) => setValue(event.currentTarget.value)}
                >
                  <For each={props.field.options}>
                    {(option) => <option value={option}>{option}</option>}
                  </For>
                </select>
              </Show>
            </label>
            <button type="submit" disabled={disabled()}>
              Apply field
            </button>
          </>
        }
      >
        <label class="editor-content-check">
          <input
            type={props.field.type === 3 ? "radio" : "checkbox"}
            name={`field-${props.field.fieldId}`}
            checked={props.field.checked}
            disabled={disabled()}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              event.currentTarget.checked = props.field.checked;
              props.onApply(checked ? props.field.exportValue : "Off");
            }}
          />
          {name()}
        </label>
      </Show>
      <Show when={props.field.readOnly}>
        <small>Read-only or unsupported field.</small>
      </Show>
    </form>
  );
}
