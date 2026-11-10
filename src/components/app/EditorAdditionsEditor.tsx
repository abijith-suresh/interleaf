import { Effect, Fiber } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { MAX_TEXT_SIZE, MIN_TEXT_SIZE } from "../../constants";
import {
  CHECKMARK_POINTS,
  CHECKMARK_STROKE,
  MAX_CHECKMARK_SIZE,
  MIN_CHECKMARK_SIZE,
  measureAddedCheckmark,
} from "../../controllers/checkmark-geometry";
import { activePageTool } from "../../controllers/editor-additions-state";
import { createPageBatchId } from "../../controllers/editor-page-state";
import {
  normalizeQuarterTurn,
  offsetPDFPoint,
  pdfToViewport,
  viewportToPDF,
} from "../../controllers/text-geometry";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { AddedCheckmark, AddedText, PageGeometry, PageState } from "../../types/interfaces";
import EditorFieldsEditor from "./EditorFieldsEditor";
import EditorButton from "./ui/EditorButton";
import EditorIcon from "./ui/EditorIcon";

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

/**
 * Saves an open draft before the user leaves it. Resolves false, with the
 * draft still open and its validation reason shown, when it cannot be saved.
 * Returns true at once when nothing is open.
 */
export type DraftCommit = () => boolean | Promise<boolean>;

export interface AdditionsGesture {
  key: (event: KeyboardEvent) => boolean;
  move: (event: PointerEvent) => boolean;
  end: (event: PointerEvent) => boolean;
  cancel: () => void;
}

interface Props {
  page: PageState;
  groupPageNumbers?: readonly number[];
  onFieldChange?: (pageId: string, fieldRef: string, value: string, originalValue: string) => void;
  runtime: PDFRuntime;
  toolbar: HTMLElement;
  /** Extra scroll room under the page, so a draft can scroll above the mobile sheet. */
  sheetSpace?: HTMLElement;
  stage: HTMLElement;
  ready: boolean;
  disabled?: boolean;
  onCheckmarksChange?: (pageId: string, marks: readonly AddedCheckmark[], label: string) => void;
  onChange: (pageId: string, texts: readonly AddedText[], label: string) => void;
  registerGesture: (gesture: AdditionsGesture | null) => void;
  registerTap: (handler: ((event: PointerEvent) => void) | null) => void;
  onEditing: (id: string | null) => void;
  /** Reports whether an unsaved text, checkmark, or field answer is open. */
  onDraftChange?: (open: boolean) => void;
  registerCommit?: (commit: DraftCommit | null) => void;
}

export default function EditorAdditionsEditor(props: Props) {
  const [toolsOpen, setToolsOpen] = createSignal(false);
  const [mode, setMode] = createSignal<"read" | "place" | "edit" | "fields">("read");
  const [geometry, setGeometry] = createSignal<PageGeometry>();
  const [rotation, setRotation] = createSignal(0);
  const [draft, setDraft] = createSignal<Addition>();
  const [tool, setTool] = createSignal<"text" | "checkmark">("text");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [fieldOpen, setFieldOpen] = createSignal(false);
  // The field panel and hint live inside the portalled toolbar, which exists after mount.
  const [panelsMounted, setPanelsMounted] = createSignal(false);
  onMount(() => setPanelsMounted(true));
  let layer!: HTMLDivElement;
  let fieldPanel!: HTMLDivElement;
  let fieldHint!: HTMLDivElement;
  let draftPanel!: HTMLDivElement;
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
  let pendingSave: Promise<boolean> | undefined;
  let fieldCommit: DraftCommit | null = null;
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
  // Every page-tool button reads its pressed state from here.
  const activeTool = createMemo(() => {
    const current = draft();
    return activePageTool({
      mode: mode(),
      placing: tool(),
      draft: current && {
        kind: isText(current) ? "text" : "checkmark",
        saved: additions().some((item) => item.id === current.id),
      },
      additions: additions().length,
    });
  });
  const activeToolName = () =>
    ({
      read: "Read",
      text: "Add text",
      checkmark: "Checkmark",
      fields: "Fill fields",
      edit: "Edit additions",
    })[activeTool()];
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
        active === props.stage || [layer, props.toolbar].some((root) => root?.contains(active)),
    };
  }

  function visible(element: HTMLElement | undefined | null): element is HTMLElement {
    return Boolean(
      element?.isConnected && element.getClientRects().length && !element.matches(":disabled")
    );
  }

  function focusElement(element: HTMLElement, reveal = element) {
    element.focus({ preventScroll: true });
    if (
      document.activeElement !== element ||
      !visible(disclosure) ||
      !props.toolbar.contains(element)
    )
      return;
    // Reveal compact settings without scrolling the document or page preview.
    for (const container of [element.closest<HTMLElement>(".editor-draft-panel"), props.toolbar]) {
      if (!container || container.scrollHeight <= container.clientHeight) continue;
      const viewport = container.getBoundingClientRect();
      const region = reveal.getBoundingClientRect();
      const field =
        region.height <= container.clientHeight - 8 ? region : element.getBoundingClientRect();
      const top = viewport.top + container.clientTop + 4;
      const bottom = viewport.top + container.clientTop + container.clientHeight - 4;
      if (field.top < top) container.scrollTop += field.top - top;
      else if (field.bottom > bottom) container.scrollTop += field.bottom - bottom;
    }
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
      if (visible(element)) focusElement(element);
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

  // On phones and touch screens the draft settings dock as a bottom sheet over
  // the lower part of the preview. Scroll the draft above the sheet.
  function revealDraft() {
    requestAnimationFrame(() => {
      if (disposed || !props.sheetSpace || !draftPanel?.getClientRects().length) return;
      if (getComputedStyle(draftPanel).position !== "fixed") return;
      const target =
        layer.querySelector<HTMLElement>(".editor-text-draft") ??
        layer.parentElement?.querySelector<HTMLElement>(".editor-field-hit.is-selected");
      if (!target) return;
      const limit = () =>
        Math.min(
          draftPanel.getBoundingClientRect().top,
          props.stage.getBoundingClientRect().bottom
        );
      if (target.getBoundingClientRect().bottom + 12 <= limit()) return;
      props.sheetSpace.style.height = `${draftPanel.offsetHeight}px`;
      const overlap = target.getBoundingClientRect().bottom + 12 - limit();
      if (overlap > 0) props.stage.scrollTop += overlap;
    });
  }

  createEffect(() => {
    if (!draft() && !fieldOpen() && props.sheetSpace) props.sheetSpace.style.height = "";
  });

  createEffect(() => {
    const pageId = props.page.id;
    const saved = JSON.stringify([props.page.addedText ?? [], props.page.addedCheckmarks ?? []]);
    const turn = props.page.rotation;
    void pageId;
    void saved;
    void turn;
    cancel();
  });

  // Field targets are clickable in Read mode too, so geometry is always read.
  createEffect(() => {
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

  createEffect(() => props.onDraftChange?.(Boolean(draft()) || fieldOpen()));
  props.registerCommit?.(commitDraft);
  createEffect(() => props.registerTap(mode() === "place" || mode() === "edit" ? place : null));
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
    props.onDraftChange?.(false);
    props.registerCommit?.(null);
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
    setToolsOpen(false);
    props.onEditing(text.id);
    focusLater(() => (isText(text) ? input : sizeInput), ticket);
    revealDraft();
  }

  function patch(change: Partial<AddedText & AddedCheckmark>) {
    setError("");
    setDraft((current) => (current ? { ...current, ...change } : current));
  }

  function commitDraft(): boolean | Promise<boolean> {
    if (pendingSave) return pendingSave;
    if (fieldOpen()) return fieldCommit?.() ?? true;
    const current = draft();
    if (!current) return true;
    const saved = additions().find((item) => item.id === current.id);
    // A draft identical to what is saved, or new text never typed, holds no work.
    if (
      saved ? JSON.stringify(saved) === JSON.stringify(current) : isText(current) && !current.text
    ) {
      finishDraft();
      return true;
    }
    return save(true);
  }

  function save(leaving = false): Promise<boolean> {
    if (pendingSave) return pendingSave;
    const text = draft();
    const g = geometry();
    if (!text || !g || props.disabled) {
      if (leaving && text)
        showFailure(
          text,
          props.disabled
            ? `An operation is in progress. Save your ${noun()} when it finishes.`
            : "Could not read page geometry. Try again."
        );
      return Promise.resolve(false);
    }
    const request = persist(text, g, leaving);
    pendingSave = request;
    void request.finally(() => {
      if (pendingSave === request) pendingSave = undefined;
    });
    return request;
  }

  function fieldToFix(text: Addition) {
    return !isText(text) ||
      !Number.isFinite(text.fontSize) ||
      text.fontSize < MIN_TEXT_SIZE ||
      text.fontSize > MAX_TEXT_SIZE
      ? sizeInput
      : input;
  }

  /** Keeps the user on a draft they tried to leave, with its reason in view. */
  function showFailure(text: Addition, message: string) {
    setError(message);
    setToolsOpen(false);
    focusLater(() => fieldToFix(text), { ...focusTicket(), owned: true });
  }

  async function persist(text: Addition, g: PageGeometry, leaving: boolean): Promise<boolean> {
    const ticket = focusTicket();
    const version = ++generation;
    setSaving(true);
    setError("");
    try {
      if (isText(text)) {
        const { validateAddedText } = await import("../../services/pdf-text");
        await validateAddedText(text, g);
      } else measureAddedCheckmark(text, g);
      if (disposed || version !== generation) return false;
      if (props.disabled) {
        const message = `An operation is in progress. Save your ${noun()} when it finishes.`;
        if (leaving) showFailure(text, message);
        else setError(message);
        return false;
      }
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
      return true;
    } catch (cause) {
      if (!disposed && version === generation) {
        const message =
          cause instanceof Error ? cause.message : `Could not save ${noun()}. Try again.`;
        // Re-enable the field before restoring focus lost to disabled controls.
        setSaving(false);
        if (leaving) showFailure(text, message);
        else {
          setError(message);
          focusLater(() => fieldToFix(text), ticket);
        }
      }
      return false;
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
    const base = { id: createPageBatchId(), ...anchor, rotation: rotation() };
    setDraft(tool() === "text" ? { ...base, text: "", fontSize: 16 } : { ...base, size: 16 });
    setMode("edit");
    setToolsOpen(false);
    setError("");
    focusLater(() => (tool() === "text" ? input : sizeInput));
    revealDraft();
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
      <Portal mount={props.toolbar}>
        {/* One fixed-height bar. Its tools swap for the open draft's settings,
            so the preview never moves. Phones dock the settings as a sheet. */}
        <fieldset
          class="editor-text-controls"
          classList={{ "has-draft": Boolean(draft()) || fieldOpen() }}
          disabled={props.disabled}
        >
          <div class="editor-context-tools">
            <div class="editor-text-mobile-bar">
              <EditorButton
                ref={disclosure}
                aria-label={`Page tool: ${activeToolName()}`}
                class="editor-text-disclosure"
                aria-expanded={toolsOpen()}
                aria-controls="editor-page-tools"
                onClick={() => setToolsOpen(!toolsOpen())}
              >
                {activeToolName()}
                <EditorIcon name="chevron-down" />
              </EditorButton>
            </div>
            <div
              id="editor-page-tools"
              class="editor-text-content"
              tabIndex={-1}
              classList={{ "is-open": toolsOpen() }}
            >
              <div class="editor-text-toolbar" role="toolbar" aria-label="Page tools">
                <EditorButton
                  icon="eye"
                  aria-pressed={activeTool() === "read"}
                  onClick={() => {
                    cancel();
                    setMode("read");
                    setToolsOpen(false);
                  }}
                >
                  Read
                </EditorButton>
                <EditorButton
                  ref={addButton}
                  icon="text"
                  aria-pressed={activeTool() === "text"}
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
                  aria-pressed={activeTool() === "checkmark"}
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
                <EditorButton
                  icon="page-actions"
                  aria-pressed={activeTool() === "fields"}
                  disabled={!props.ready || saving() || Boolean(draft()) || !props.onFieldChange}
                  onClick={() => {
                    cancel();
                    setMode("fields");
                    setToolsOpen(false);
                  }}
                >
                  Fill fields
                </EditorButton>
                <EditorButton
                  icon="page-actions"
                  aria-label="Select additions"
                  aria-pressed={activeTool() === "edit"}
                  title={
                    additions().length > 0
                      ? "Select an addition to edit it"
                      : "Add text or a checkmark first"
                  }
                  disabled={saving() || additions().length === 0}
                  onClick={() => {
                    cancel();
                    setMode("edit");
                    setToolsOpen(false);
                  }}
                >
                  Edit additions
                </EditorButton>
              </div>
            </div>
            <div class="editor-context-hint">
              <Show when={mode() === "place"}>
                <span class="editor-text-hint" role="status">
                  Tap the page or press Enter in the preview.
                </span>
              </Show>
              <div ref={fieldHint} />
              <Show when={error() && !draft()}>
                <p class="editor-text-error" role="alert">
                  {error()}
                </p>
              </Show>
            </div>
          </div>
          <div ref={draftPanel} class="editor-draft-panel">
            <Show when={draft()}>
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
                <span class="editor-text-font editor-draft-status" role="status">
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
            <div ref={fieldPanel} />
          </div>
        </fieldset>
      </Portal>
      <div
        ref={layer}
        data-geometry-ready={Boolean(geometry())}
        class="editor-text-layer"
        classList={{
          "is-editing": mode() === "place" || mode() === "edit",
          "is-placing": mode() === "place",
        }}
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
                  setToolsOpen(false);
                  const field = checkmark() ? sizeInput : input;
                  if (visible(field)) focusElement(field);
                }}
              >
                {isText(text()) ? (text() as AddedText).text || "Type text" : <CheckmarkShape />}
              </button>
            )}
          </Show>
        </Show>
      </div>
      <Show
        when={panelsMounted() && (mode() === "fields" || mode() === "read") && props.onFieldChange}
      >
        <EditorFieldsEditor
          active={mode() === "fields"}
          onActivate={() => {
            cancel();
            setMode("fields");
            setToolsOpen(false);
          }}
          page={props.page}
          groupPageNumbers={props.groupPageNumbers ?? [props.page.sourcePageNumber]}
          runtime={props.runtime}
          geometry={geometry()}
          rotation={rotation()}
          toolbar={fieldPanel}
          hint={fieldHint}
          stage={props.stage}
          disabled={props.disabled}
          onOpen={() => {
            setToolsOpen(false);
            revealDraft();
          }}
          onDraftChange={setFieldOpen}
          registerCommit={(commit) => {
            fieldCommit = commit;
          }}
          focusInput={focusElement}
          onChange={(pageId, fieldRef, value, originalValue) =>
            props.onFieldChange?.(pageId, fieldRef, value, originalValue)
          }
        />
      </Show>
    </>
  );
}
