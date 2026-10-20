import { Effect, Fiber } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { MAX_TEXT_SIZE, MIN_TEXT_SIZE } from "../../constants";
import {
  normalizeQuarterTurn,
  pdfToViewport,
  viewportToPDF,
} from "../../controllers/text-geometry";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { AddedText, PageGeometry, PageState } from "../../types/interfaces";
import EditorButton from "./ui/EditorButton";

export interface TextGesture {
  move: (event: PointerEvent) => boolean;
  end: (event: PointerEvent) => boolean;
  cancel: () => void;
}

interface Props {
  page: PageState;
  runtime: PDFRuntime;
  toolbar: HTMLElement;
  header: HTMLElement;
  ready: boolean;
  disabled?: boolean;
  onChange: (pageId: string, texts: readonly AddedText[], label: string) => void;
  registerGesture: (gesture: TextGesture | null) => void;
  registerTap: (handler: ((event: PointerEvent) => void) | null) => void;
  onEditing: (id: string | null) => void;
}

export default function EditorTextEditor(props: Props) {
  const [toolsOpen, setToolsOpen] = createSignal(false);
  const [mode, setMode] = createSignal<"read" | "place" | "edit">("read");
  const [geometry, setGeometry] = createSignal<PageGeometry>();
  const [rotation, setRotation] = createSignal(0);
  const [draft, setDraft] = createSignal<AddedText>();
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [settings, setSettings] = createSignal(true);
  let layer!: HTMLDivElement;
  let input: HTMLInputElement | undefined;
  let disposed = false;
  let generation = 0;
  let drag:
    | { pointer: number; x: number; y: number; original: AddedText; moved: boolean }
    | undefined;

  const texts = () => props.page.addedText ?? [];
  const textMode = createMemo(() => mode() !== "read");
  const visibleSize = createMemo(() => {
    const g = geometry();
    return g
      ? rotation() % 180
        ? { width: g.height, height: g.width }
        : g
      : { width: 1, height: 1 };
  });

  function cancel() {
    generation++;
    setDraft(undefined);
    setError("");
    setSaving(false);
    drag = undefined;
    props.onEditing(null);
  }

  createEffect(() => {
    const pageId = props.page.id;
    const saved = JSON.stringify(props.page.addedText ?? []);
    const turn = props.page.rotation;
    void pageId;
    void saved;
    void turn;
    cancel();
  });

  createEffect(() => {
    if (!textMode()) return;
    const page = props.page;
    const file = page.sourceFile;
    const number = page.sourcePageNumber;
    const turn = page.rotation;
    setGeometry(undefined);
    const fiber = props.runtime.runFork(
      PDFProcessing.use((service) =>
        Effect.gen(function* () {
          const g = yield* service.getPageGeometry(file, number);
          const intrinsic = yield* service.getPageRotation(file, number);
          return { g, rotation: normalizeQuarterTurn(intrinsic + turn) };
        })
      )
    );
    let live = true;
    void Effect.runPromise(Fiber.join(fiber)).then(
      (result) => {
        if (!live || disposed) return;
        setGeometry(result.g);
        setRotation(result.rotation);
      },
      () => {
        if (live && !disposed) setError("Could not read page geometry. Try again.");
      }
    );
    onCleanup(() => {
      live = false;
      void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined);
    });
  });

  createEffect(() => props.registerTap(mode() === "read" ? null : place));
  props.registerGesture({
    move: pointerMove,
    end: pointerEnd,
    cancel: () => {
      if (drag) {
        setDraft(drag.original);
        drag = undefined;
      }
    },
  });
  onCleanup(() => {
    disposed = true;
    generation++;
    props.onEditing(null);
    props.registerTap(null);
    props.registerGesture(null);
  });

  function position(event: PointerEvent) {
    const g = geometry();
    if (!g) return null;
    const rect = layer.getBoundingClientRect();
    const size = visibleSize();
    return viewportToPDF(
      g,
      rotation(),
      ((event.clientX - rect.left) / rect.width) * size.width,
      ((event.clientY - rect.top) / rect.height) * size.height
    );
  }

  function startEdit(text: AddedText) {
    if (saving()) return;
    cancel();
    setMode("edit");
    setDraft({ ...text });
    setSettings(true);
    setToolsOpen(true);
    props.onEditing(text.id);
    queueMicrotask(() => input?.focus({ preventScroll: true }));
  }

  function patch(change: Partial<AddedText>) {
    setError("");
    setDraft((current) => (current ? { ...current, ...change } : current));
  }

  async function save() {
    const text = draft();
    const g = geometry();
    if (!text || !g || saving()) return;
    const version = ++generation;
    setSaving(true);
    setError("");
    try {
      const { validateAddedText } = await import("../../services/pdf-text");
      await validateAddedText(text, g);
      if (disposed || version !== generation) return;
      const existed = texts().some((item) => item.id === text.id);
      const next = existed
        ? texts().map((item) => (item.id === text.id ? { ...text } : { ...item }))
        : [...texts(), { ...text }];
      props.onChange(props.page.id, next, existed ? "Edit text" : "Add text");
      cancel();
      setMode("edit");
      setToolsOpen(false);
    } catch (cause) {
      if (!disposed && version === generation)
        setError(cause instanceof Error ? cause.message : "Could not save text. Try again.");
    } finally {
      if (!disposed && version === generation) setSaving(false);
    }
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || !props.ready || saving()) return;
    const text = draft();
    if (text && (event.target as HTMLElement).closest(".editor-text-draft")) {
      const point = position(event);
      if (!point) return;
      event.preventDefault();
      drag = {
        pointer: event.pointerId,
        x: point.x,
        y: point.y,
        original: { ...text },
        moved: false,
      };
    }
  }

  function pointerMove(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return false;
    event.preventDefault();
    const point = position(event);
    if (!point) return false;
    const distance = Math.hypot(point.x - drag.x, point.y - drag.y) * (geometry()?.userUnit ?? 1);
    if (distance > 2) drag.moved = true;
    if (drag.moved)
      patch({ x: drag.original.x + point.x - drag.x, y: drag.original.y + point.y - drag.y });
    return true;
  }

  function pointerEnd(event: PointerEvent) {
    if (drag?.pointer !== event.pointerId) return false;
    drag = undefined;
    return true;
  }

  function place(event: PointerEvent) {
    if (mode() === "edit" && !draft()) {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLButtonElement>(".editor-text-hit");
      const text = texts().find((text) => target?.dataset.textId === text.id);
      if (text) startEdit(text);
      return;
    }
    if (mode() !== "place" || !geometry() || !props.ready || draft()) return;
    const rect = layer.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return;
    const point = position(event);
    if (!point) return;
    setDraft({ id: crypto.randomUUID(), text: "", ...point, fontSize: 16, rotation: rotation() });
    setMode("edit");
    setSettings(true);
    setToolsOpen(true);
    setError("");
    queueMicrotask(() => input?.focus({ preventScroll: true }));
  }

  function style(text: AddedText) {
    const g = geometry();
    if (!g) return {};
    const p = pdfToViewport(g, rotation(), text.x, text.y);
    const size = visibleSize();
    // CSS text is an interactive draft. Saved appearance comes from the generated PDF.
    return {
      left: `${(100 * p.x) / size.width}%`,
      top: `${(100 * p.y) / size.height}%`,
      "font-size": `${(100 * text.fontSize) / size.width}cqw`,
      transform: `rotate(${rotation() - text.rotation}deg) translateY(-78%)`,
    };
  }

  return (
    <>
      <Portal mount={props.header}>
        <fieldset class="editor-text-mobile-bar" disabled={props.disabled}>
          <EditorButton
            aria-pressed={mode() === "read"}
            onClick={() => {
              cancel();
              setMode("read");
              setToolsOpen(false);
            }}
          >
            Read
          </EditorButton>
          <EditorButton
            icon="text"
            aria-label="Text tools"
            aria-pressed={mode() !== "read"}
            class="editor-text-disclosure"
            aria-expanded={toolsOpen()}
            onClick={() => setToolsOpen(!toolsOpen())}
          ></EditorButton>
        </fieldset>
      </Portal>
      <Portal mount={props.toolbar}>
        <fieldset class="editor-text-controls" disabled={props.disabled}>
          <Show when={mode() === "place" && !toolsOpen()}>
            <span class="editor-text-hint editor-text-mobile-hint" role="status">
              Tap the page to place text.
            </span>
          </Show>
          <div class="editor-text-content" classList={{ "is-open": toolsOpen() }}>
            <div class="editor-text-toolbar" role="toolbar" aria-label="Text tools">
              <EditorButton
                aria-pressed={mode() === "read"}
                onClick={() => {
                  cancel();
                  setMode("read");
                }}
              >
                Read
              </EditorButton>
              <EditorButton
                icon="text"
                aria-pressed={mode() === "place"}
                disabled={!props.ready || saving()}
                onClick={() => {
                  cancel();
                  setMode("place");
                  setToolsOpen(false);
                }}
              >
                Add text
              </EditorButton>
              <Show when={texts().length > 0}>
                <EditorButton
                  icon="page-actions"
                  aria-label="Select added text"
                  aria-pressed={mode() === "edit"}
                  disabled={saving()}
                  onClick={() => {
                    cancel();
                    setMode("edit");
                  }}
                >
                  Edit text
                </EditorButton>
              </Show>
              <Show when={mode() === "place"}>
                <span class="editor-text-hint" role="status">
                  Tap the page to place text.
                </span>
              </Show>
              <Show when={draft()}>
                <EditorButton aria-expanded={settings()} onClick={() => setSettings(!settings())}>
                  Text settings
                </EditorButton>
              </Show>
            </div>
            <Show when={draft() && settings()}>
              <form
                class="editor-text-settings"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancel();
                  }
                }}
              >
                <label class="editor-text-value">
                  Text{" "}
                  <input
                    ref={input}
                    aria-label="Added text"
                    onPaste={(event) => {
                      if (/[\r\n]/.test(event.clipboardData?.getData("text/plain") ?? "")) {
                        event.preventDefault();
                        setError("Use one line of text.");
                      }
                    }}
                    value={draft()?.text ?? ""}
                    disabled={saving()}
                    onInput={(event) => patch({ text: event.currentTarget.value })}
                  />
                </label>
                <label>
                  Size{" "}
                  <input
                    type="number"
                    aria-label="Text size in points"
                    min={MIN_TEXT_SIZE}
                    max={MAX_TEXT_SIZE}
                    value={draft()?.fontSize}
                    disabled={saving()}
                    onInput={(event) => patch({ fontSize: event.currentTarget.valueAsNumber })}
                  />
                </label>
                <span class="editor-text-font">Helvetica · pt</span>
                <EditorButton
                  icon="rotate"
                  aria-label="Rotate text 90 degrees"
                  disabled={saving()}
                  onClick={() =>
                    patch({ rotation: normalizeQuarterTurn((draft()?.rotation ?? 0) - 90) })
                  }
                />
                <EditorButton type="submit" variant="primary" disabled={saving()}>
                  {saving() ? "Saving…" : "Save text"}
                </EditorButton>
                <EditorButton disabled={saving()} onClick={cancel}>
                  Cancel
                </EditorButton>
                <Show when={texts().some((text) => text.id === draft()?.id)}>
                  <EditorButton
                    icon="delete"
                    aria-label="Delete added text"
                    variant="danger"
                    disabled={saving()}
                    onClick={() => {
                      const id = draft()?.id;
                      props.onChange(
                        props.page.id,
                        texts().filter((text) => text.id !== id),
                        "Delete text"
                      );
                      cancel();
                    }}
                  >
                    Delete
                  </EditorButton>
                </Show>
                <Show when={error()}>
                  <p class="editor-text-error" role="alert">
                    {error()}
                  </p>
                </Show>
              </form>
            </Show>

            <Show when={error() && !draft()}>
              <p class="editor-text-error" role="alert">
                {error()}
              </p>
            </Show>
          </div>
        </fieldset>
      </Portal>
      <div
        ref={layer}
        data-geometry-ready={Boolean(geometry())}
        class="editor-text-layer"
        classList={{ "is-editing": mode() !== "read", "is-placing": mode() === "place" }}
        onPointerDown={pointerDown}
      >
        <Show when={mode() === "edit" && geometry()}>
          <For each={texts().filter((text) => text.id !== draft()?.id)}>
            {(text) => (
              <button
                type="button"
                class="editor-text-hit"
                data-text-id={text.id}
                style={style(text)}
                aria-label={`Edit added text: ${text.text}`}
                onClick={(event) => {
                  event.stopPropagation();
                  startEdit(text);
                }}
              >
                {text.text}
              </button>
            )}
          </For>
          <Show when={draft()}>
            {(text) => (
              <button
                type="button"
                class="editor-text-draft"
                aria-label="Drag text to move it"
                style={style(text())}
                onClick={() => {
                  setSettings(true);
                  input?.focus({ preventScroll: true });
                }}
              >
                {text().text || "Type text"}
              </button>
            )}
          </Show>
        </Show>
      </div>
    </>
  );
}
