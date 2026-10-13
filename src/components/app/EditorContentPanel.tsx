import { Effect } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { PDFDocumentCheckpoint } from "../../services/pdf-checkpoint";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type {
  PDFContentEdit,
  PDFFormField,
  PDFFormSuggestion,
  PDFPageContent,
  PDFTextRun,
} from "../../services/pdfium/protocol";
import type { PageState } from "../../types/interfaces";
import {
  boxStyle,
  closestPageTarget,
  originalPoint,
  type PageBox,
  rotatedDraftBox,
} from "./pdf-page-geometry";
import EditorButton from "./ui/EditorButton";
import EditorIcon from "./ui/EditorIcon";

type Mode = "read" | "add" | "replace" | "forms";
type FormTool = "fields" | "text" | "cross";
function fieldValue(field?: PDFFormField) {
  if (!field) return undefined;
  return [2, 3].includes(field.type)
    ? field.checked
      ? field.exportValue
      : "Off"
    : (field.options[field.selectedOption] ?? field.value);
}
function fieldLabel(field: PDFFormField) {
  return `${field.name || `Field ${field.index + 1}`}${field.type === 3 ? ` · ${field.exportValue}` : ""}`;
}
interface Props {
  page: PageState;
  runtime: PDFRuntime;
  overlayRoot?: HTMLElement;
  rotation?: number;
  mode: Mode;
  locked?: boolean;
  onFocusBounds?: (bounds: PageBox, width: number, height: number) => void;
  onComposerHeight?: (height: number) => void;
  onChange: (file: File, pageNumber?: number) => void;
  onBusy: (busy: boolean) => void;
  onDraft?: (draft: boolean) => void;
  onSelection?: (selected: boolean) => void;
  onCheckpoint?: (file: File, checkpoint: PDFDocumentCheckpoint, label: string) => void;
}

export default function EditorContentPanel(props: Props) {
  const mode = () => props.mode;
  const [content, setContent] = createSignal<PDFPageContent>();
  const [run, setRun] = createSignal<PDFTextRun>();
  const [field, setField] = createSignal<PDFFormField>();
  const [position, setPosition] = createSignal<{ x: number; y: number }>();
  const [formPlacement, setFormPlacement] = createSignal<FormTool>();
  const [text, setText] = createSignal("");
  const [fontSize, setFontSize] = createSignal(14);
  const [textRotation, setTextRotation] = createSignal(0);
  const [width, setWidth] = createSignal(200);
  const [mutating, setBusy] = createSignal(false);
  const busy = () => mutating() || !!props.locked;
  let composerObserver: ResizeObserver | undefined;
  let dragging: { id: number; x: number; y: number; origin: { x: number; y: number } } | undefined;
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [advance, setAdvance] = createSignal<number>();
  let generation = 0,
    disposed = false;
  let inspectedPage: string | undefined;
  let inspectedRevision: number | undefined;
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
  let saveButton: HTMLButtonElement | undefined;
  let pointer: { x: number; y: number; id: number } | undefined;
  const selected = () => !!(run() || field() || position());
  const dirty = () => selected() && text() !== (fieldValue(field()) ?? run()?.text ?? "");
  createEffect(() => {
    if (props.mode) {
      clearSelection();
      setFormPlacement(undefined);
      if (props.mode === "forms") {
        setTextRotation(0);
        setFontSize(14);
      }
      setMessage("");
    }
  });
  createEffect(() => props.onDraft?.(dirty()));
  createEffect(() => props.onSelection?.(selected()));
  const fields = createMemo(
    () =>
      content()
        ?.fields.filter((item) => !item.readOnly)
        .sort(
          (a, b) =>
            (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0) || (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0)
        ) ?? []
  );
  const formTool = () => formPlacement() ?? (fields().length ? "fields" : "text");
  const canPlace = () => mode() === "add" || (mode() === "forms" && formTool() !== "fields");
  const crossDraft = () => mode() === "forms" && formTool() === "cross" && !!position();
  const helper = () =>
    loading()
      ? "Reading page…"
      : mode() === "replace"
        ? content()?.text.some((item) => item.editable)
          ? "Select highlighted text."
          : "No editable text on this page."
        : mode() === "forms"
          ? formTool() === "fields"
            ? `${fields().length} interactive ${fields().length === 1 ? "field" : "fields"}`
            : formTool() === "cross"
              ? "Tap a checkbox to cross it."
              : "Tap a blank to fill."
          : "Tap the page to place text.";
  const toolLabel = () =>
    mode() === "forms" ? "Fill forms" : mode() === "replace" ? "Edit text" : "Add text";

  function clearSelection() {
    setRun(undefined);
    setField(undefined);
    setPosition(undefined);
    setText("");
    setError(false);
  }
  function focusInput() {
    queueMicrotask(() => {
      if (!disposed) {
        if (crossDraft()) {
          saveButton?.focus();
          return;
        }
        input?.focus();
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)
          input.select();
      }
    });
  }
  function selectField(item: PDFFormField, internal = false) {
    if ((!internal && busy()) || item.readOnly) return;
    clearSelection();
    setField(item);
    setText(fieldValue(item) ?? "");
    setMessage("");
    focusInput();
    if (item.bounds && content())
      props.onFocusBounds?.(item.bounds, content()?.width ?? 1, content()?.height ?? 1);
    queueMicrotask(() => reveal(item.bounds));
  }
  function reveal(bounds?: PageBox) {
    if (!bounds || !content() || !props.overlayRoot) return;
    const c = content();
    if (!c) return;
    const s = boxStyle(bounds, c.width, c.height, props.rotation ?? 0);
    const stage = props.overlayRoot.parentElement;
    if (!stage) return;
    const y =
      props.overlayRoot.offsetTop +
      (Number.parseFloat(s.top) / 100) * props.overlayRoot.clientHeight;
    const x =
      props.overlayRoot.offsetLeft +
      (Number.parseFloat(s.left) / 100) * props.overlayRoot.clientWidth;
    stage.scrollTo?.({
      top: Math.max(0, y - stage.clientHeight * 0.25),
      left: Math.max(
        0,
        x -
          Math.max(
            16,
            (stage.clientWidth -
              (Number.parseFloat(s.width) / 100) * props.overlayRoot.clientWidth) /
              2
          )
      ),
      behavior: "smooth",
    });
  }
  onMount(() => {
    const revealSelection = () => {
      requestAnimationFrame(() => {
        if (!disposed)
          reveal(field()?.bounds ?? run()?.bounds ?? (position() ? draftBox() : undefined));
      });
    };
    window.visualViewport?.addEventListener("resize", revealSelection);
    onCleanup(() => window.visualViewport?.removeEventListener("resize", revealSelection));
  });
  createEffect(() => {
    const page = props.page;
    const revision = page.contentRevision ?? 0;
    if (inspectedPage === page.id && inspectedRevision !== revision) {
      clearSelection();
      setMessage("");
    }
    inspectedPage = page.id;
    inspectedRevision = revision;
    const current = ++generation;
    setLoading(true);
    void props.runtime
      .runPromise(
        PDFProcessing.use((service) =>
          service.getPageContent(page.sourceFile, page.sourcePageNumber)
        )
      )
      .then(
        (next) => {
          if (current !== generation || disposed) return;
          setContent(next);
          setLoading(false);
          const nextIndex = advance();
          if (nextIndex !== undefined) {
            setAdvance(undefined);
            const nextField = next.fields.find((item) => item.index === nextIndex);
            if (nextField) selectField(nextField, true);
          }
        },
        (cause) => {
          if (current === generation && !disposed) {
            setMessage(cause instanceof Error ? cause.message : "Could not inspect page.");
            setError(true);
            setLoading(false);
          }
        }
      );
  });
  createEffect(() => {
    void props.page.id;
    setContent(undefined);
    setFormPlacement(undefined);
    clearSelection();
    setMessage("");
  });
  onCleanup(() => {
    disposed = true;
    generation++;
    props.onDraft?.(false);
    props.onSelection?.(false);
    composerObserver?.disconnect();
  });

  async function apply(edit: PDFContentEdit, next?: number) {
    if (busy() || loading()) return;
    const page = props.page;
    setBusy(true);
    props.onBusy(true);
    setMessage("");
    setError(false);
    try {
      const checkpoint = await props.runtime.runPromise(
        PDFProcessing.use((service) =>
          props.onCheckpoint
            ? service.editPageUndoable(page.sourceFile, page.sourcePageNumber, edit)
            : service
                .editPage(page.sourceFile, page.sourcePageNumber, edit)
                .pipe(Effect.as(undefined as PDFDocumentCheckpoint | undefined))
        )
      );
      if (disposed) return;
      if (checkpoint)
        props.onCheckpoint?.(
          page.sourceFile,
          checkpoint,
          edit.kind === "form"
            ? "fill field"
            : edit.kind === "replace"
              ? "replace text"
              : crossDraft()
                ? "mark checkbox"
                : mode() === "forms"
                  ? "fill blank"
                  : "add text"
        );
      clearSelection();
      setAdvance(next);
      props.onChange(page.sourceFile, edit.kind === "form" ? undefined : page.sourcePageNumber);
      // Refresh independently: consumers do not have to remount or bump a revision.
      const result = await props.runtime.runPromise(
        PDFProcessing.use((service) =>
          service.getPageContent(page.sourceFile, page.sourcePageNumber)
        )
      );
      if (!disposed) {
        setContent(result);
        if (next !== undefined) {
          const item = result.fields.find((f) => f.index === next);
          if (item) selectField(item, true);
          setAdvance(undefined);
        }
        setMessage("Applied to this page.");
      }
    } catch (cause) {
      if (!disposed) {
        setError(true);
        setMessage(cause instanceof Error ? cause.message : "Could not apply change.");
      }
    } finally {
      if (!disposed) setBusy(false);
      props.onBusy(false);
    }
  }
  function selectRun(item: PDFTextRun) {
    if (busy() || !item.editable) return;
    clearSelection();
    setRun(item);
    setText(item.text);
    setMessage("");
    focusInput();
    if (item.bounds && content())
      props.onFocusBounds?.(item.bounds, content()?.width ?? 1, content()?.height ?? 1);
    queueMicrotask(() => reveal(item.bounds));
  }
  function place(clientX?: number, clientY?: number) {
    const c = content();
    if (busy() || loading() || !canPlace() || !c) return;
    const rect = props.overlayRoot?.getBoundingClientRect();
    const rotated = (props.rotation ?? 0) % 180 !== 0;
    const point =
      rect && clientX !== undefined && clientY !== undefined
        ? originalPoint(
            ((clientX - rect.left) / rect.width) * (rotated ? c.height : c.width),
            ((clientY - rect.top) / rect.height) * (rotated ? c.width : c.height),
            c.width,
            c.height,
            props.rotation ?? 0
          )
        : { x: c.width * 0.15, y: c.height * 0.2 };
    const cross = mode() === "forms" && formTool() === "cross";
    const existingText = position() ? text() : cross ? "X" : "";
    const existingWidth = position() ? width() : cross ? fontSize() * 1.5 : 200;
    clearSelection();
    setText(existingText);
    setPosition({
      x: Math.max(0, Math.min(point.x, c.width - 24)),
      y: Math.max(0, Math.min(point.y, c.height - 2 * fontSize())),
    });
    setWidth(Math.min(existingWidth, c.width - (position()?.x ?? 0)));
    setMessage("");
    queueMicrotask(() => reveal(draftBox()));
    focusInput();
  }
  function save(next = false) {
    const item = field(),
      original = run(),
      point = position();
    if (item) {
      const following = fields()[fields().findIndex((f) => f.index === item.index) + 1];
      if (!dirty()) {
        if (next && following) selectField(following);
        else {
          clearSelection();
          setMessage("No changes to apply.");
        }
        return;
      }
      void apply(
        { kind: "form", index: item.index, value: text() },
        next ? following?.index : undefined
      );
    } else if (original)
      void apply({
        kind: "replace",
        index: original.index,
        text: text(),
        expectedText: original.text,
      });
    else if (point && content())
      void apply({
        kind: "add",
        text: text(),
        x: point.x,
        y: (content()?.height ?? 1) - point.y - fontSize(),
        width: Math.min(width(), (content()?.width ?? 1) - point.x),
        fontSize: fontSize(),
        rotation: textRotation(),
      });
  }
  function placeSuggestion(suggestion: PDFFormSuggestion) {
    if (busy() || loading() || dirty()) return;
    clearSelection();
    const cross = suggestion.kind === "checkbox";
    const bounds = suggestion.bounds;
    const size = Math.floor(Math.max(6, Math.min(cross ? 18 : 14, bounds.height * 0.7)));
    setFormPlacement(cross ? "cross" : "text");
    setTextRotation(0);
    setFontSize(size);
    setText(cross ? "X" : "");
    setWidth(Math.max(1, cross ? size * 1.2 : bounds.width - 6));
    setPosition({
      x: bounds.x + (cross ? Math.max(0, (bounds.width - size * 0.67) / 2) : 3),
      y: bounds.y + Math.max(0, (bounds.height - size) / 2),
    });
    setMessage("");
    queueMicrotask(() => reveal(draftBox()));
    focusInput();
  }
  const style = (box: PageBox) =>
    boxStyle(box, content()?.width ?? 1, content()?.height ?? 1, props.rotation ?? 0);
  const draftBox = (): PageBox =>
    rotatedDraftBox(
      {
        x: position()?.x ?? 0,
        y: position()?.y ?? 0,
        width: width(),
        height: fontSize() * 1.3,
      },
      textRotation(),
      fontSize()
    );

  function measureComposer(element: HTMLFormElement) {
    composerObserver?.disconnect();
    const measure = () => {
      props.onComposerHeight?.(Math.ceil(element.getBoundingClientRect().height));
      requestAnimationFrame(() => {
        if (!disposed && selected())
          reveal(field()?.bounds ?? run()?.bounds ?? (position() ? draftBox() : undefined));
      });
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      composerObserver = new ResizeObserver(measure);
      composerObserver.observe(element);
    }
  }
  function pickTarget(x?: number, y?: number) {
    if (busy() || loading() || dirty()) return;
    const c = content(),
      rect = props.overlayRoot?.getBoundingClientRect();
    if (!c) return;
    const targets: readonly (PDFFormField | PDFTextRun)[] = mode() === "forms" ? c.fields : c.text;
    const target =
      x !== undefined && y !== undefined && rect
        ? closestPageTarget(
            targets,
            x - rect.left,
            y - rect.top,
            c.width,
            c.height,
            props.rotation ?? 0,
            rect.width,
            rect.height
          )
        : targets.find((item) => ("editable" in item ? item.editable : !item.readOnly));
    if (!target) return;
    if ("editable" in target) {
      if (target.editable) selectRun(target);
      else setMessage(target.reason ?? "This text cannot be replaced.");
    } else if (target.readOnly) setMessage("This field is read-only or unsupported.");
    else if ([2, 3].includes(target.type))
      void apply({
        kind: "form",
        index: target.index,
        value: target.checked && target.type === 2 ? "Off" : target.exportValue,
      });
    else selectField(target);
  }
  function moveDraft(event: PointerEvent) {
    const start = dragging;
    if (!start || start.id !== event.pointerId) return;
    moveDraftBy(start.origin, event.clientX - start.x, event.clientY - start.y);
  }
  function moveDraftBy(origin: { x: number; y: number }, dx: number, dy: number) {
    const c = content(),
      rect = props.overlayRoot?.getBoundingClientRect();
    if (!c || !rect) return;
    const rotated = (props.rotation ?? 0) % 180 !== 0;
    const from = originalPoint(0, 0, c.width, c.height, props.rotation ?? 0);
    const to = originalPoint(
      (dx / rect.width) * (rotated ? c.height : c.width),
      (dy / rect.height) * (rotated ? c.width : c.height),
      c.width,
      c.height,
      props.rotation ?? 0
    );
    const box = rotatedDraftBox(
      { x: origin.x, y: origin.y, width: width(), height: fontSize() * 1.3 },
      textRotation(),
      fontSize()
    );
    const x = Math.max(
      origin.x - box.x,
      Math.min(c.width - box.width + origin.x - box.x, origin.x + to.x - from.x)
    );
    const y = Math.max(
      origin.y - box.y,
      Math.min(c.height - box.height + origin.y - box.y, origin.y + to.y - from.y)
    );
    setPosition({ x, y });
  }

  return (
    <section
      class="editor-content-panel"
      aria-label="Page content"
      classList={{
        "has-selection": selected(),
        "is-reading": mode() === "read",
        "is-text-tool": !!position(),
      }}
      data-tool={mode()}
    >
      <Show when={!selected() && mode() !== "read"}>
        <div class="editor-content-tool-context" classList={{ "is-forms": mode() === "forms" }}>
          <div class="editor-content-tool-copy">
            <strong>{toolLabel()}</strong>
            <p>{helper()}</p>
          </div>
          <Show when={!loading() && mode() === "forms"}>
            <fieldset class="editor-form-tools" aria-label="Form filling mode">
              <Show when={fields().length}>
                <EditorButton
                  variant="plain"
                  aria-label="Fill existing fields"
                  aria-pressed={formTool() === "fields"}
                  disabled={busy()}
                  onClick={() => {
                    setFormPlacement("fields");
                    setMessage("");
                  }}
                >
                  Fields
                </EditorButton>
              </Show>
              <EditorButton
                variant="plain"
                aria-label="Place form text"
                aria-pressed={formTool() === "text"}
                disabled={busy()}
                onClick={() => {
                  setFormPlacement("text");
                  setTextRotation(0);
                  setMessage("");
                }}
              >
                Text
              </EditorButton>
              <EditorButton
                variant="plain"
                aria-label="Place X mark"
                aria-pressed={formTool() === "cross"}
                disabled={busy()}
                onClick={() => {
                  setFormPlacement("cross");
                  setTextRotation(0);
                  setMessage("");
                }}
              >
                <EditorIcon name="close" size={14} /> Mark
              </EditorButton>
            </fieldset>
          </Show>
        </div>
      </Show>
      <Show when={props.overlayRoot && content()}>
        <Portal mount={props.overlayRoot}>
          <div
            class="editor-content-overlay"
            classList={{ "is-placement": canPlace() && !busy() && !loading() }}
          >
            <Show when={(mode() === "forms" && formTool() === "fields") || mode() === "replace"}>
              <button
                class="editor-content-target-surface"
                type="button"
                aria-label={mode() === "forms" ? "Select field on page" : "Select text on page"}
                disabled={busy() || loading() || dirty()}
                onPointerDown={(event) => {
                  pointer = event.isPrimary
                    ? { id: event.pointerId, x: event.clientX, y: event.clientY }
                    : undefined;
                }}
                onPointerUp={(event) => {
                  const start = pointer;
                  pointer = undefined;
                  if (
                    start?.id === event.pointerId &&
                    Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8
                  )
                    pickTarget(event.clientX, event.clientY);
                }}
                onPointerCancel={() => {
                  pointer = undefined;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    pickTarget();
                  }
                }}
              />
            </Show>
            <Show when={canPlace()}>
              <button
                type="button"
                class="editor-content-placement"
                aria-label={
                  mode() === "forms"
                    ? formTool() === "cross"
                      ? "Place X mark on page"
                      : "Fill blank on page"
                    : "Place text on page"
                }
                disabled={busy() || loading()}
                onPointerDown={(e) => {
                  if (!e.isPrimary || (pointer && pointer.id !== e.pointerId)) {
                    pointer = undefined;
                    return;
                  }
                  pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
                }}
                onPointerUp={(e) => {
                  const start = pointer;
                  pointer = undefined;
                  if (
                    start?.id === e.pointerId &&
                    Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8
                  )
                    place(e.clientX, e.clientY);
                }}
                onPointerCancel={() => {
                  pointer = undefined;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    place();
                  }
                }}
              />
            </Show>
            <Show when={mode() === "replace"}>
              <For each={content()?.text.filter((item) => item.bounds && item.editable)}>
                {(item) => (
                  <button
                    type="button"
                    class="editor-content-hit is-text"
                    classList={{ "is-selected": run()?.index === item.index }}
                    style={style(item.bounds ?? { x: 0, y: 0, width: 0, height: 0 })}
                    aria-label={`Edit ${item.text}`}
                    title={item.text}
                    disabled={busy() || loading() || dirty()}
                    onClick={() => selectRun(item)}
                  />
                )}
              </For>
            </Show>
            <Show when={mode() === "forms" && formTool() === "fields"}>
              <For each={content()?.fields.filter((item) => item.bounds)}>
                {(item) => (
                  <button
                    type="button"
                    class="editor-content-hit is-field"
                    classList={{
                      "is-selected": field()?.index === item.index,
                      "is-readonly": item.readOnly,
                    }}
                    style={style(item.bounds ?? { x: 0, y: 0, width: 0, height: 0 })}
                    aria-label={`${item.type === 2 || item.type === 3 ? (item.checked ? "Uncheck" : "Check") : "Fill"} ${fieldLabel(item)}`}
                    title={item.readOnly ? "Read-only or unsupported field." : item.name}
                    disabled={busy() || loading() || item.readOnly || dirty()}
                    onClick={() => {
                      if ([2, 3].includes(item.type))
                        void apply({
                          kind: "form",
                          index: item.index,
                          value: item.checked && item.type === 2 ? "Off" : item.exportValue,
                        });
                      else selectField(item);
                    }}
                  />
                )}
              </For>
            </Show>
            <Show when={mode() === "forms" && formTool() !== "fields"}>
              <For each={content()?.suggestions ?? []}>
                {(suggestion) => (
                  <button
                    type="button"
                    class="editor-content-hit is-suggestion"
                    style={style(suggestion.bounds)}
                    aria-label={
                      suggestion.kind === "checkbox"
                        ? "Mark suggested checkbox"
                        : "Fill suggested blank"
                    }
                    title={
                      suggestion.kind === "checkbox"
                        ? "Mark printed checkbox"
                        : "Fill suggested blank"
                    }
                    disabled={busy() || loading() || dirty()}
                    onClick={() => placeSuggestion(suggestion)}
                  />
                )}
              </For>
            </Show>
            <Show when={position()}>
              <>
                <button
                  type="button"
                  class="editor-content-draft"
                  aria-label="Move draft text"
                  style={style(draftBox())}
                  disabled={busy()}
                  onKeyDown={(event) => {
                    const origin = position();
                    if (!origin || busy() || !event.key.startsWith("Arrow")) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const step = event.shiftKey ? 10 : 1;
                    moveDraftBy(
                      origin,
                      event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0,
                      event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0
                    );
                  }}
                  onPointerDown={(event) => {
                    const origin = position();
                    if (!origin || !event.isPrimary) return;
                    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, origin };
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  }}
                  onPointerMove={moveDraft}
                  onPointerUp={() => {
                    dragging = undefined;
                  }}
                  onPointerCancel={() => {
                    dragging = undefined;
                  }}
                >
                  {" "}
                  <span class="editor-content-draft-handle" aria-hidden="true">
                    <EditorIcon name="move" size={14} />
                  </span>
                </button>
                <svg
                  class="editor-content-preview"
                  viewBox={`0 0 ${(props.rotation ?? 0) % 180 ? (content()?.height ?? 1) : (content()?.width ?? 1)} ${(props.rotation ?? 0) % 180 ? (content()?.width ?? 1) : (content()?.height ?? 1)}`}
                  aria-hidden="true"
                >
                  <g
                    transform={
                      (props.rotation ?? 0) === 90
                        ? `translate(${content()?.height ?? 1} 0) rotate(90)`
                        : (props.rotation ?? 0) === 180
                          ? `translate(${content()?.width ?? 1} ${content()?.height ?? 1}) rotate(180)`
                          : (props.rotation ?? 0) === 270
                            ? `translate(0 ${content()?.width ?? 1}) rotate(270)`
                            : undefined
                    }
                  >
                    <text
                      x={position()?.x ?? 0}
                      y={(position()?.y ?? 0) + fontSize()}
                      font-size={String(fontSize())}
                      font-family="Helvetica, Arial, sans-serif"
                      transform={`rotate(${textRotation()} ${position()?.x ?? 0} ${(position()?.y ?? 0) + fontSize()})`}
                      fill="black"
                    >
                      {text() || "Type here"}
                    </text>
                  </g>
                </svg>
              </>
            </Show>
          </div>
        </Portal>
      </Show>
      <Show when={selected()}>
        <form
          class="editor-content-composer"
          ref={measureComposer}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && field() && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              save(true);
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              if (!busy()) {
                clearSelection();
                setMessage("Draft cancelled.");
              }
            }
          }}
        >
          <header>
            <div>
              <h3>
                {field()
                  ? fieldLabel(field() as PDFFormField)
                  : run()
                    ? "Edit text"
                    : mode() === "forms"
                      ? crossDraft()
                        ? "Checkbox mark"
                        : "Fill form"
                      : "Add text"}
              </h3>
            </div>
            <EditorButton
              variant="plain"
              icon="close"
              iconOnly
              aria-label="Cancel edit"
              disabled={busy()}
              onClick={() => {
                clearSelection();
                setMessage("Draft cancelled.");
              }}
            />
          </header>
          <Show when={!crossDraft()}>
            <Show
              when={!field() || ![2, 3].includes(field()?.type ?? 0)}
              fallback={
                <label>
                  <input
                    ref={(element) => {
                      input = element;
                    }}
                    type={field()?.type === 3 ? "radio" : "checkbox"}
                    checked={text() !== "Off"}
                    onChange={(e) =>
                      setText(e.currentTarget.checked ? (field()?.exportValue ?? "Yes") : "Off")
                    }
                  />
                  {field() ? fieldLabel(field() as PDFFormField) : ""}
                </label>
              }
            >
              <label>
                <span class="editor-content-input-label">
                  {field() ? fieldLabel(field() as PDFFormField) : "Text"}
                </span>
                <Show when={field()}>
                  <span class="editor-content-field-progress">
                    {fields().findIndex((item) => item.index === field()?.index) + 1} /{" "}
                    {fields().length}
                  </span>
                </Show>
                <Show
                  when={
                    field() &&
                    [4, 5].includes(field()?.type ?? 0) &&
                    !((field()?.flags ?? 0) & (1 << 18))
                  }
                  fallback={
                    <Show
                      when={field()?.type === 6 && (field()?.flags ?? 0) & (1 << 12)}
                      fallback={
                        <input
                          ref={(element) => {
                            input = element;
                          }}
                          aria-label={field() ? field()?.name || "Field value" : "Text"}
                          type={
                            field()?.flags && (field()?.flags ?? 0) & (1 << 13)
                              ? "password"
                              : "text"
                          }
                          value={text()}
                          maxLength={field() ? undefined : 1000}
                          autocomplete="off"
                          autocorrect="off"
                          spellcheck={false}
                          disabled={busy()}
                          onInput={(e) => setText(e.currentTarget.value)}
                        />
                      }
                    >
                      <textarea
                        ref={(element) => {
                          input = element;
                        }}
                        aria-label={field()?.name || "Field value"}
                        rows={3}
                        value={text()}
                        autocomplete="off"
                        autocorrect="off"
                        spellcheck={false}
                        disabled={busy()}
                        onInput={(event) => setText(event.currentTarget.value)}
                      />
                    </Show>
                  }
                >
                  <select
                    ref={(element) => {
                      input = element;
                    }}
                    aria-label={field()?.name || "Field value"}
                    value={text()}
                    disabled={busy()}
                    onChange={(e) => setText(e.currentTarget.value)}
                  >
                    <option value="">Choose an option</option>
                    <For each={field()?.options}>
                      {(option) => <option value={option}>{option}</option>}
                    </For>
                  </select>
                </Show>
              </label>
            </Show>
          </Show>
          <Show when={position()}>
            <div class="editor-content-format-bar">
              <EditorButton
                variant="secondary"
                icon="rotate"
                disabled={busy()}
                aria-label="Rotate draft text 90 degrees"
                onClick={() => setTextRotation((value) => ((value + 270) % 360) - 180)}
              >
                {textRotation()}°
              </EditorButton>
              <label>
                Size{" "}
                <input
                  aria-label="Text size"
                  type="number"
                  min="6"
                  max="144"
                  value={fontSize()}
                  onInput={(event) => setFontSize(event.currentTarget.valueAsNumber)}
                />
              </label>
              <details class="editor-content-more">
                <summary aria-label="More text options" title="More text options">
                  <EditorIcon name="tools" />
                </summary>
                <div class="editor-content-position">
                  <label>
                    Rotation
                    <input
                      type="number"
                      min="-180"
                      max="180"
                      step="1"
                      value={textRotation()}
                      onInput={(event) => setTextRotation(event.currentTarget.valueAsNumber)}
                    />
                  </label>
                  <label>
                    Width
                    <input
                      type="number"
                      step="any"
                      min="1"
                      max={(content()?.width ?? 1) - (position()?.x ?? 0)}
                      value={width()}
                      onInput={(e) => setWidth(e.currentTarget.valueAsNumber)}
                    />
                  </label>
                  <label>
                    Left
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={position()?.x ?? 0}
                      onInput={(e) =>
                        setPosition({
                          ...(position() ?? { x: 0, y: 0 }),
                          x: e.currentTarget.valueAsNumber,
                        })
                      }
                    />
                  </label>
                  <label>
                    Top
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={position()?.y ?? 0}
                      onInput={(e) =>
                        setPosition({
                          ...(position() ?? { x: 0, y: 0 }),
                          y: e.currentTarget.valueAsNumber,
                        })
                      }
                    />
                  </label>
                </div>
              </details>
            </div>
          </Show>
          <Show when={!field()}>
            <p class="editor-content-note">
              Helvetica · Basic Latin only.{run() ? " Keep the original width." : ""}
            </p>
          </Show>
          <Show when={error()}>
            <p class="editor-content-error" role="alert">
              {message()}
            </p>
          </Show>
          <div class="editor-content-actions">
            <EditorButton
              disabled={busy()}
              onClick={() => {
                clearSelection();
                setMessage("Draft cancelled.");
              }}
            >
              Cancel
            </EditorButton>
            <Show
              when={
                field() &&
                fields().findIndex((item) => item.index === field()?.index) < fields().length - 1
              }
            >
              <EditorButton
                class="editor-content-next"
                disabled={busy() || loading()}
                onClick={() => save(true)}
              >
                Save & next
              </EditorButton>
            </Show>
            <EditorButton
              ref={(element) => {
                saveButton = element;
              }}
              variant="primary"
              class="editor-content-apply"
              type="submit"
              disabled={
                busy() ||
                loading() ||
                (!field() && !text().trim()) ||
                (!!(field() || run()) && !dirty())
              }
            >
              {busy()
                ? "Applying…"
                : field()
                  ? "Save field"
                  : run()
                    ? "Replace text"
                    : mode() === "forms"
                      ? crossDraft()
                        ? "Add X mark"
                        : "Fill text"
                      : "Add text"}
            </EditorButton>
          </div>
        </form>
      </Show>
      <p
        class="editor-content-message"
        classList={{ "has-message": !!message() && !selected() }}
        role="status"
        aria-live="polite"
      >
        {!selected() ? message() : ""}
      </p>
    </section>
  );
}
