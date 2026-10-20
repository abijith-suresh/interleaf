import { Effect, Fiber } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { MAX_TEXT_SIZE, MIN_TEXT_SIZE } from "../../constants";
import {
  CHECKMARK_POINTS,
  CHECKMARK_STROKE,
  MAX_CHECKMARK_SIZE,
  MIN_CHECKMARK_SIZE,
  measureAddedCheckmark,
} from "../../controllers/checkmark-geometry";
import {
  normalizeQuarterTurn,
  offsetPDFPoint,
  pdfToViewport,
  viewportToPDF,
} from "../../controllers/text-geometry";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { AddedCheckmark, AddedText, PageGeometry, PageState } from "../../types/interfaces";
import EditorButton from "./ui/EditorButton";

type Addition = AddedText | AddedCheckmark;
const isText = (item: Addition): item is AddedText => "text" in item;
const additionSize = (item: Addition) => (isText(item) ? item.fontSize : item.size);

function CheckmarkShape() {
  return (
    <svg viewBox="0 0 1 1" aria-hidden="true" class="editor-checkmark-shape">
      <polyline
        points={CHECKMARK_POINTS.map(([x, y]) => `${x},${1 - y}`).join(" ")}
        fill="none"
        stroke="currentColor"
        stroke-width={CHECKMARK_STROKE}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export interface AdditionsGesture {
  key: (event: KeyboardEvent) => boolean;
  move: (event: PointerEvent) => boolean;
  end: (event: PointerEvent) => boolean;
  cancel: () => void;
}

interface Props {
  page: PageState;
  runtime: PDFRuntime;
  toolbar: HTMLElement;
  header: HTMLElement;
  stage: HTMLElement;
  ready: boolean;
  disabled?: boolean;
  onCheckmarksChange?: (pageId: string, marks: readonly AddedCheckmark[], label: string) => void;
  onChange: (pageId: string, texts: readonly AddedText[], label: string) => void;
  registerGesture: (gesture: AdditionsGesture | null) => void;
  registerTap: (handler: ((event: PointerEvent) => void) | null) => void;
  onEditing: (id: string | null) => void;
}

export default function EditorAdditionsEditor(props: Props) {
  const [toolsOpen, setToolsOpen] = createSignal(false);
  const [mode, setMode] = createSignal<"read" | "place" | "edit">("read");
  const [geometry, setGeometry] = createSignal<PageGeometry>();
  const [rotation, setRotation] = createSignal(0);
  const [draft, setDraft] = createSignal<Addition>();
  const [tool, setTool] = createSignal<"text" | "checkmark">("text");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [settings, setSettings] = createSignal(true);
  let layer!: HTMLDivElement;
  let input: HTMLInputElement | undefined;
  let sizeInput: HTMLInputElement | undefined;
  let addButton: HTMLButtonElement | undefined;
  let disclosure: HTMLButtonElement | undefined;
  let focusRevision = 0;
  const trackFocus = () => focusRevision++;
  document.addEventListener("focusin", trackFocus);
  document.addEventListener("pointerdown", trackFocus, true);
  let disposed = false;
  let generation = 0;
  let drag:
    | { pointer: number; x: number; y: number; original: Addition; moved: boolean }
    | undefined;

  const texts = () => props.page.addedText ?? [];
  const marks = () => props.page.addedCheckmarks ?? [];
  const additions = (): readonly Addition[] => [...texts(), ...marks()];
  const checkmark = () => {
    const current = draft();
    return current ? !isText(current) : tool() === "checkmark";
  };
  const noun = () => (checkmark() ? "checkmark" : "text");
  const minimumSize = () => (checkmark() ? MIN_CHECKMARK_SIZE : MIN_TEXT_SIZE);
  const maximumSize = () => (checkmark() ? MAX_CHECKMARK_SIZE : MAX_TEXT_SIZE);
  const textMode = createMemo(() => mode() !== "read");
  const invalidSize = () => {
    const current = draft();
    const size = current ? additionSize(current) : undefined;
    return (
      size === undefined || !Number.isFinite(size) || size < minimumSize() || size > maximumSize()
    );
  };
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

  function focusTicket() {
    const active = document.activeElement;
    return {
      pageId: props.page.id,
      revision: focusRevision,
      owned:
        active === props.stage ||
        [layer, props.toolbar, props.header].some((root) => root?.contains(active)),
    };
  }

  function visible(element: HTMLElement | undefined | null): element is HTMLElement {
    return Boolean(
      element?.isConnected && element.getClientRects().length && !element.matches(":disabled")
    );
  }

  function focusLater(target: () => HTMLElement | undefined, ticket = focusTicket()) {
    const version = generation;
    queueMicrotask(() => {
      if (
        disposed ||
        props.page.id !== ticket.pageId ||
        generation !== version ||
        focusRevision !== ticket.revision ||
        !ticket.owned
      )
        return;
      const element = target();
      if (visible(element)) element.focus({ preventScroll: true });
    });
  }

  function completionTarget(id?: string) {
    const hit = Array.from(layer.querySelectorAll<HTMLButtonElement>(".editor-text-hit")).find(
      (element) => element.dataset.textId === id
    );
    if (visible(hit)) {
      const box = hit.getBoundingClientRect();
      const view = props.stage.getBoundingClientRect();
      if (
        box.right > view.left &&
        box.left < view.right &&
        box.bottom > view.top &&
        box.top < view.bottom
      )
        return hit;
    }
    return visible(disclosure) ? disclosure : visible(addButton) ? addButton : props.stage;
  }

  function finishDraft() {
    const ticket = focusTicket();
    const id = draft()?.id;
    cancel();
    setToolsOpen(false);
    focusLater(() => completionTarget(id), ticket);
  }

  createEffect(() => {
    const pageId = props.page.id;
    const saved = JSON.stringify([props.page.addedText ?? [], props.page.addedCheckmarks ?? []]);
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
    key: previewKey,
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
    document.removeEventListener("focusin", trackFocus);
    document.removeEventListener("pointerdown", trackFocus, true);
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

  function startEdit(text: Addition) {
    if (saving()) return;
    const ticket = focusTicket();
    cancel();
    setMode("edit");
    setDraft({ ...text });
    setTool(isText(text) ? "text" : "checkmark");
    setSettings(true);
    setToolsOpen(true);
    props.onEditing(text.id);
    focusLater(() => (isText(text) ? input : sizeInput), ticket);
  }

  function patch(change: Partial<AddedText & AddedCheckmark>) {
    setError("");
    setDraft((current) => (current ? { ...current, ...change } : current));
  }

  async function save() {
    const text = draft();
    const g = geometry();
    if (!text || !g || saving()) return;
    const ticket = focusTicket();
    const version = ++generation;
    setSaving(true);
    setError("");
    try {
      if (isText(text)) {
        const { validateAddedText } = await import("../../services/pdf-text");
        await validateAddedText(text, g);
      } else measureAddedCheckmark(text, g);
      if (disposed || version !== generation) return;
      const items = isText(text) ? texts() : marks();
      const existed = items.some((item) => item.id === text.id);
      const next = existed
        ? items.map((item) => (item.id === text.id ? { ...text } : { ...item }))
        : [...items, { ...text }];
      const label = `${existed ? "Edit" : "Add"} ${isText(text) ? "text" : "checkmark"}`;
      if (isText(text)) props.onChange(props.page.id, next as AddedText[], label);
      else props.onCheckmarksChange?.(props.page.id, next as AddedCheckmark[], label);
      cancel();
      setMode("edit");
      setToolsOpen(false);
      focusLater(() => completionTarget(text.id), ticket);
    } catch (cause) {
      if (!disposed && version === generation) {
        setError(cause instanceof Error ? cause.message : `Could not save ${noun()}. Try again.`);
        // Re-enable the field before restoring focus lost to disabled controls.
        setSaving(false);
        focusLater(
          () =>
            !isText(text) ||
            !Number.isFinite(text.fontSize) ||
            text.fontSize < MIN_TEXT_SIZE ||
            text.fontSize > MAX_TEXT_SIZE
              ? sizeInput
              : input,
          ticket
        );
      }
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
      const text = additions().find((text) => target?.dataset.textId === text.id);
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
    createDraft(point);
  }

  function createDraft(point: { x: number; y: number }) {
    const g = geometry();
    // Center the checkmark on the chosen checkbox or visible keyboard target.
    const anchor =
      tool() === "checkmark" && g ? offsetPDFPoint(g, rotation(), point, -8, 8) : point;
    const base = { id: crypto.randomUUID(), ...anchor, rotation: rotation() };
    setDraft(tool() === "text" ? { ...base, text: "", fontSize: 16 } : { ...base, size: 16 });
    setMode("edit");
    setSettings(true);
    setToolsOpen(true);
    setError("");
    focusLater(() => (tool() === "text" ? input : sizeInput));
  }

  function previewKey(event: KeyboardEvent) {
    if (event.target !== props.stage || mode() !== "place") return false;
    if (event.key === "Escape") {
      cancel();
      setMode("read");
      event.preventDefault();
      return true;
    }
    if (event.key !== "Enter" && event.key !== " ") return false;
    event.preventDefault();
    const g = geometry();
    if (!g || !props.ready || draft() || props.disabled) return true;
    const box = layer.getBoundingClientRect();
    const view = props.stage.getBoundingClientRect();
    const size = visibleSize();
    const x = (Math.max(box.left, view.left) + Math.min(box.right, view.right)) / 2;
    const y = (Math.max(box.top, view.top) + Math.min(box.bottom, view.bottom)) / 2;
    createDraft(
      viewportToPDF(
        g,
        rotation(),
        ((x - box.left) * size.width) / box.width,
        ((y - box.top) * size.height) / box.height
      )
    );
    return true;
  }

  function draftKey(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey || saving() || props.disabled) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishDraft();
      return;
    }
    const g = geometry();
    const text = draft();
    if (!g || !text || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    patch(
      offsetPDFPoint(
        g,
        rotation(),
        text,
        event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
      )
    );
  }

  function style(text: Addition) {
    const g = geometry();
    if (!g) return {};
    const p = pdfToViewport(g, rotation(), text.x, text.y);
    const size = visibleSize();
    // CSS text is an interactive draft. Saved appearance comes from the generated PDF.
    return {
      left: `${(100 * p.x) / size.width}%`,
      top: `${(100 * p.y) / size.height}%`,
      "font-size": `${(100 * additionSize(text)) / size.width}cqw`,
      transform: `rotate(${rotation() - text.rotation}deg) translateY(${isText(text) ? "-78%" : "-100%"})`,
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
            ref={disclosure}
            aria-label="Tools"
            aria-pressed={mode() !== "read"}
            class="editor-text-disclosure"
            aria-expanded={toolsOpen()}
            onClick={() => setToolsOpen(!toolsOpen())}
          >
            Tools
          </EditorButton>
        </fieldset>
      </Portal>
      <Portal mount={props.toolbar}>
        <fieldset class="editor-text-controls" disabled={props.disabled}>
          <Show when={mode() === "place" && !toolsOpen()}>
            <span class="editor-text-hint editor-text-mobile-hint" role="status">
              Tap the page or press Enter in the preview.
            </span>
          </Show>
          <div class="editor-text-content" classList={{ "is-open": toolsOpen() }}>
            <div class="editor-text-toolbar" role="toolbar" aria-label="Page tools">
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
                ref={addButton}
                icon="text"
                aria-pressed={mode() === "place" && tool() === "text"}
                disabled={!props.ready || saving()}
                onClick={() => {
                  const ticket = focusTicket();
                  cancel();
                  setTool("text");
                  setMode("place");
                  setToolsOpen(false);
                  focusLater(() => props.stage, ticket);
                }}
              >
                Add text
              </EditorButton>
              <EditorButton
                icon="checkmark"
                aria-pressed={mode() === "place" && tool() === "checkmark"}
                disabled={!props.ready || saving() || !props.onCheckmarksChange}
                onClick={() => {
                  const ticket = focusTicket();
                  cancel();
                  setTool("checkmark");
                  setMode("place");
                  setToolsOpen(false);
                  focusLater(() => props.stage, ticket);
                }}
              >
                Checkmark
              </EditorButton>
              <Show when={additions().length > 0}>
                <EditorButton
                  icon="page-actions"
                  aria-label="Select additions"
                  aria-pressed={mode() === "edit"}
                  disabled={saving()}
                  onClick={() => {
                    cancel();
                    setMode("edit");
                  }}
                >
                  Edit additions
                </EditorButton>
              </Show>
              <Show when={mode() === "place"}>
                <span class="editor-text-hint" role="status">
                  Tap the page or press Enter in the preview.
                </span>
              </Show>
              <Show when={draft()}>
                <EditorButton aria-expanded={settings()} onClick={() => setSettings(!settings())}>
                  {checkmark() ? "Checkmark settings" : "Text settings"}
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
                    finishDraft();
                  }
                }}
              >
                <span class="editor-text-font" role="status">
                  {additions().some((item) => item.id === draft()?.id) ? "Editing saved" : "Draft"}{" "}
                  {noun()}
                </span>
                <Show when={!checkmark()}>
                  <label class="editor-text-value">
                    Text{" "}
                    <input
                      ref={input}
                      aria-label="Added text"
                      aria-invalid={Boolean(error()) && !invalidSize()}
                      aria-describedby={error() && !invalidSize() ? "editor-text-error" : undefined}
                      onPaste={(event) => {
                        if (/[\r\n]/.test(event.clipboardData?.getData("text/plain") ?? "")) {
                          event.preventDefault();
                          setError("Use one line of text.");
                        }
                      }}
                      value={(() => {
                        const item = draft();
                        return item && isText(item) ? item.text : "";
                      })()}
                      disabled={saving()}
                      onInput={(event) => patch({ text: event.currentTarget.value })}
                    />
                  </label>
                </Show>
                <label>
                  Size{" "}
                  <input
                    ref={sizeInput}
                    type="number"
                    aria-label={checkmark() ? "Checkmark size in points" : "Text size in points"}
                    aria-invalid={Boolean(error()) && (checkmark() || invalidSize())}
                    aria-describedby={
                      error() && (checkmark() || invalidSize()) ? "editor-text-error" : undefined
                    }
                    min={minimumSize()}
                    max={maximumSize()}
                    value={(() => {
                      const current = draft();
                      return current ? additionSize(current) : undefined;
                    })()}
                    disabled={saving()}
                    onInput={(event) =>
                      patch(
                        checkmark()
                          ? { size: event.currentTarget.valueAsNumber }
                          : { fontSize: event.currentTarget.valueAsNumber }
                      )
                    }
                  />
                </label>
                <span class="editor-text-font">{checkmark() ? "pt" : "Helvetica · pt"}</span>
                <EditorButton
                  icon="rotate"
                  aria-label={`Rotate ${noun()} 90 degrees`}
                  disabled={saving()}
                  onClick={() =>
                    patch({ rotation: normalizeQuarterTurn((draft()?.rotation ?? 0) - 90) })
                  }
                />
                <EditorButton type="submit" variant="primary" disabled={saving()}>
                  {saving() ? "Saving…" : `Save ${noun()}`}
                </EditorButton>
                <EditorButton disabled={saving()} onClick={finishDraft}>
                  Cancel
                </EditorButton>
                <Show when={additions().some((text) => text.id === draft()?.id)}>
                  <EditorButton
                    icon="delete"
                    aria-label={`Delete added ${noun()}`}
                    variant="danger"
                    disabled={saving()}
                    onClick={() => {
                      const ticket = focusTicket();
                      const id = draft()?.id;
                      if (checkmark())
                        props.onCheckmarksChange?.(
                          props.page.id,
                          marks().filter((mark) => mark.id !== id),
                          "Delete checkmark"
                        );
                      else
                        props.onChange(
                          props.page.id,
                          texts().filter((text) => text.id !== id),
                          "Delete text"
                        );
                      cancel();
                      setToolsOpen(false);
                      focusLater(() => completionTarget(), ticket);
                    }}
                  >
                    Delete
                  </EditorButton>
                </Show>
                <Show when={error()}>
                  <p id="editor-text-error" class="editor-text-error" role="alert">
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
        <p id="editor-text-placement-help" class="sr-only">
          {mode() === "place"
            ? `Press Enter or Space to place ${tool() === "text" ? "text" : "a checkmark"} at the visible page center. Escape cancels placement.`
            : "Use arrow keys to pan. Choose an addition to edit."}
        </p>
        <p id="editor-text-move-help" class="sr-only">
          Arrow keys move the draft by 1 point. Shift moves 10 points. Enter opens settings. Escape
          cancels.
        </p>
        <Show when={mode() === "edit" && geometry()}>
          <For each={additions().filter((text) => text.id !== draft()?.id)}>
            {(text) => (
              <button
                type="button"
                class="editor-text-hit"
                classList={{ "editor-checkmark": !isText(text) }}
                data-text-id={text.id}
                style={style(text)}
                aria-label={isText(text) ? `Edit added text: ${text.text}` : "Edit added checkmark"}
                onClick={(event) => {
                  event.stopPropagation();
                  startEdit(text);
                }}
              >
                {isText(text) ? text.text : <CheckmarkShape />}
              </button>
            )}
          </For>
          <Show when={draft()}>
            {(text) => (
              <button
                type="button"
                class="editor-text-draft"
                classList={{ "editor-checkmark": !isText(text()) }}
                aria-label={`Drag ${noun()} to move it`}
                aria-describedby="editor-text-move-help"
                onFocus={(event) => {
                  // The compact popup must not cover keyboard movement.
                  if (visible(disclosure) && event.currentTarget.matches(":focus-visible"))
                    setToolsOpen(false);
                }}
                onKeyDown={draftKey}
                style={style(text())}
                onClick={() => {
                  setToolsOpen(true);
                  setSettings(true);
                  (checkmark() ? sizeInput : input)?.focus({ preventScroll: true });
                }}
              >
                {isText(text()) ? (text() as AddedText).text || "Type text" : <CheckmarkShape />}
              </button>
            )}
          </Show>
        </Show>
      </div>
    </>
  );
}
