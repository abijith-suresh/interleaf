import { Effect, Fiber } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { answerField, orderFieldWidgets } from "../../controllers/editor-field-state";
import { pdfToViewport } from "../../controllers/text-geometry";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { PageGeometry, PageState, PDFFields, TextFieldWidget } from "../../types/interfaces";
import type { DraftCommit } from "./EditorAdditionsEditor";
import EditorButton from "./ui/EditorButton";

interface Props {
  page: PageState;
  groupPageNumbers: readonly number[];
  runtime: PDFRuntime;
  geometry?: PageGeometry;
  rotation: number;
  toolbar: HTMLElement;
  stage: HTMLElement;
  disabled?: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDraftChange?: (open: boolean) => void;
  registerCommit?: (commit: DraftCommit | null) => void;
  focusInput: (input: HTMLElement, reveal?: HTMLElement) => void;
  onChange: (pageId: string, fieldRef: string, value: string, originalValue: string) => void;
}

export default function EditorFieldsEditor(props: Props) {
  const [fields, setFields] = createSignal<PDFFields>();
  const [selected, setSelected] = createSignal<TextFieldWidget>();
  const [answer, setAnswer] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const sourceFile = createMemo(() => props.page.sourceFile);
  let input!: HTMLInputElement;
  let layer!: HTMLDivElement;
  let panel!: HTMLDivElement;
  let answerRegion!: HTMLSpanElement;
  const drafts = new Map<string, string>();
  let ownCommit:
    | { pageId: string; file: File; group?: string; rotation: number; answers: string }
    | undefined;
  let disposed = false;
  let generation = 0;
  let focusRevision = 0;
  let savingFiber: Fiber.Fiber<unknown, unknown> | undefined;
  let pendingSave: Promise<boolean> | undefined;
  const trackFocus = () => focusRevision++;
  document.addEventListener("focusin", trackFocus);
  document.addEventListener("pointerdown", trackFocus, true);
  const widgets = createMemo(() => {
    const own =
      fields()?.widgets.filter((widget) => widget.pageNumber === props.page.sourcePageNumber) ?? [];
    return props.geometry ? orderFieldWidgets(own, props.geometry, props.rotation) : own;
  });
  const navigable = createMemo(() => widgets().filter((widget) => !widget.reason));
  const position = () =>
    navigable().findIndex((widget) => widget.widgetRef === selected()?.widgetRef);
  const currentValue = (widget: TextFieldWidget) =>
    props.page.fieldAnswers?.find((answer) => answer.fieldRef === widget.fieldRef)?.value ??
    widget.value;
  function ownedFocus() {
    const active = document.activeElement;
    return active === props.stage || layer?.contains(active) || panel?.contains(active);
  }
  function focusLater(target: () => HTMLElement | undefined, revision = focusRevision) {
    const version = generation;
    queueMicrotask(() => {
      const element = target();
      if (
        !disposed &&
        version === generation &&
        revision === focusRevision &&
        element?.isConnected &&
        element.getClientRects().length
      )
        props.focusInput(element, element === input && error() ? answerRegion : undefined);
    });
  }
  function hit(widget?: TextFieldWidget) {
    return Array.from(layer.querySelectorAll<HTMLButtonElement>("[data-widget-ref]")).find(
      (button) => button.dataset.widgetRef === widget?.widgetRef
    );
  }
  function finish() {
    const widget = selected();
    if (widget) drafts.delete(widget.fieldRef);
    const owned = ownedFocus();
    generation++;
    setSelected(undefined);
    setError("");
    setSaving(false);
    props.onClose();
    if (owned) focusLater(() => hit(widget) ?? props.stage);
  }
  function choose(widget: TextFieldWidget) {
    if (saving()) return;
    generation++;
    setSelected(undefined);
    setError("");
    setNotice("");
    if (widget.reason) {
      setNotice(widget.reason);
      props.onOpen();
      return;
    }
    setSelected(widget);
    setAnswer(drafts.get(widget.fieldRef) ?? currentValue(widget));
    props.onOpen();
    focusLater(() => input);
  }
  function navigate(offset: number) {
    const next = navigable()[position() + offset];
    if (next) choose(next);
  }
  function commitAnswer(): boolean | Promise<boolean> {
    if (pendingSave) return pendingSave;
    const widget = selected();
    if (!widget) return true;
    if (answer() === currentValue(widget)) {
      finish();
      return true;
    }
    return save(true);
  }
  /** Keeps the user on an answer they tried to leave, with its reason in view. */
  function showFailure(message: string) {
    setError(message);
    props.onOpen();
    focusLater(() => input);
  }
  /**
   * Saves the answer, then opens the field `offset` steps away, or closes when there is none.
   * A `leaving` save keeps the user on the answer when it fails.
   */
  function save(leaving = false, offset = 0): Promise<boolean> {
    if (pendingSave) return pendingSave;
    const widget = selected();
    if (!widget || props.disabled) {
      if (leaving && widget)
        showFailure("An operation is in progress. Save your answer when it finishes.");
      return Promise.resolve(false);
    }
    const request = persist(widget, leaving, offset);
    pendingSave = request;
    void request.finally(() => {
      if (pendingSave === request) pendingSave = undefined;
    });
    return request;
  }
  async function persist(
    widget: TextFieldWidget,
    leaving: boolean,
    offset: number
  ): Promise<boolean> {
    const version = generation;
    const pageId = props.page.id;
    const value = answer();
    const revision = focusRevision;
    const owned = ownedFocus();
    setSaving(true);
    setError("");
    const fiber = props.runtime.runFork(
      PDFProcessing.use((service) =>
        service.validateFieldAnswer(props.page.sourceFile, { fieldRef: widget.fieldRef, value }, [
          ...props.groupPageNumbers,
        ])
      )
    );
    savingFiber = fiber;
    try {
      await Effect.runPromise(Fiber.join(fiber));
      if (disposed || generation !== version) return false;
      if (props.disabled) {
        setSaving(false);
        const message = "An operation is in progress. Save your answer when it finishes.";
        if (leaving) showFailure(message);
        else setError(message);
        return false;
      }
      // A later unrelated focus change may not be stolen by Save completion.
      const restore =
        revision === focusRevision &&
        owned &&
        (ownedFocus() || document.activeElement === document.body);
      const commit = {
        pageId,
        file: props.page.sourceFile,
        group: props.page.fieldGroupId,
        rotation: props.page.rotation,
        answers: JSON.stringify(
          answerField([props.page], pageId, widget.fieldRef, value, widget.value)[0].fieldAnswers ??
            []
        ),
      };
      ownCommit = commit;
      props.onChange(pageId, widget.fieldRef, value, widget.value);
      drafts.delete(widget.fieldRef);
      queueMicrotask(() => {
        if (ownCommit === commit) ownCommit = undefined;
      });
      const next = offset ? navigable()[position() + offset] : undefined;
      setSaving(false);
      if (next && restore) {
        choose(next);
        return true;
      }
      generation++;
      setSelected(undefined);
      props.onClose();
      if (restore) focusLater(() => hit(widget) ?? props.stage);
      return true;
    } catch (cause) {
      if (disposed || generation !== version) return false;
      setSaving(false);
      const message = cause instanceof Error ? cause.message : "Could not save the answer.";
      if (leaving) {
        showFailure(message);
        return false;
      }
      setError(message);
      if (
        revision === focusRevision &&
        owned &&
        (ownedFocus() || document.activeElement === document.body)
      )
        focusLater(() => input);
      return false;
    } finally {
      if (savingFiber === fiber) savingFiber = undefined;
    }
  }
  createEffect(() => {
    const file = sourceFile();
    setFields(undefined);
    const fiber = props.runtime.runFork(PDFProcessing.use((service) => service.getFields(file)));
    let live = true;
    void Effect.runPromise(Fiber.join(fiber)).then(
      (result) => {
        if (live) {
          setFields(result);
          if (
            result.reason ||
            !result.widgets.some((widget) => widget.pageNumber === props.page.sourcePageNumber)
          )
            props.onOpen();
        }
      },
      () => {
        if (live)
          setFields({ widgets: [], reason: "Could not read embedded fields. Use Add text." });
      }
    );
    onCleanup(() => {
      live = false;
      void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined);
    });
  });
  createEffect(() => props.onDraftChange?.(Boolean(selected())));
  props.registerCommit?.(commitAnswer);
  let draftOwner: { pageId: string; file: File; group?: string } | undefined;
  createEffect(() => {
    const pageId = props.page.id,
      file = props.page.sourceFile,
      group = props.page.fieldGroupId,
      rotation = props.page.rotation;
    const answers = JSON.stringify(props.page.fieldAnswers ?? []);
    const own =
      ownCommit?.pageId === pageId &&
      ownCommit.file === file &&
      ownCommit.group === group &&
      ownCommit.rotation === rotation &&
      ownCommit.answers === answers;
    ownCommit = undefined;
    // Save already settled the editor, and may have opened the next field.
    if (own) return;
    // Unsaved answers for other fields belong to this logical page. Keep them
    // across history changes to the same page; drop them only for another page.
    const samePage =
      draftOwner?.pageId === pageId && draftOwner.file === file && draftOwner.group === group;
    draftOwner = { pageId, file, group };
    untrack(() => {
      if (!samePage) drafts.clear();
      generation++;
      setSelected(undefined);
      setError("");
      setSaving(false);
      setNotice("");
    });
  });
  onCleanup(() => {
    disposed = true;
    generation++;
    props.onDraftChange?.(false);
    props.registerCommit?.(null);
    if (savingFiber) void Effect.runPromise(Fiber.interrupt(savingFiber)).catch(() => undefined);
    document.removeEventListener("focusin", trackFocus);
    document.removeEventListener("pointerdown", trackFocus, true);
  });
  function style(widget: TextFieldWidget) {
    const geometry = props.geometry;
    if (!geometry) return {};
    const a = pdfToViewport(geometry, props.rotation, widget.rect[0], widget.rect[1]);
    const b = pdfToViewport(geometry, props.rotation, widget.rect[2], widget.rect[3]);
    const size =
      props.rotation % 180 ? { width: geometry.height, height: geometry.width } : geometry;
    return {
      left: `${(100 * Math.min(a.x, b.x)) / size.width}%`,
      top: `${(100 * Math.min(a.y, b.y)) / size.height}%`,
      width: `${(100 * Math.abs(b.x - a.x)) / size.width}%`,
      height: `${(100 * Math.abs(b.y - a.y)) / size.height}%`,
    };
  }
  return (
    <>
      <Portal mount={props.toolbar}>
        <div ref={panel}>
          <Show when={!selected()}>
            <p class="editor-field-help" role="status">
              {notice() ||
                fields()?.reason ||
                (fields()
                  ? widgets().length
                    ? "Select an embedded field on the page."
                    : "No embedded fields on this page. Use Add text."
                  : "Reading fields…")}
            </p>
          </Show>
          <Show when={selected()}>
            {(widget) => (
              <form
                class="editor-text-settings editor-field-settings"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    finish();
                  }
                  if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                    event.preventDefault();
                    navigate(event.key === "ArrowDown" ? 1 : -1);
                  }
                }}
              >
                <label class="editor-text-value">
                  <span class="editor-field-label">{widget().label}</span>
                  <span ref={answerRegion} class="editor-field-answer">
                    <input
                      ref={input}
                      aria-label={`Answer for ${widget().label}`}
                      value={answer()}
                      aria-invalid={!!error()}
                      aria-describedby={error() ? "editor-field-error" : "editor-field-input-help"}
                      disabled={saving() || props.disabled}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.isComposing) return;
                        if (event.ctrlKey || event.metaKey || event.altKey) return;
                        // Enter saves and moves on. Shift+Enter saves and goes back.
                        event.preventDefault();
                        void save(false, event.shiftKey ? -1 : 1);
                      }}
                      onInput={(event) => {
                        setAnswer(event.currentTarget.value);
                        drafts.set(widget().fieldRef, event.currentTarget.value);
                        setError("");
                      }}
                      onPaste={(event) => {
                        if (/[^\x20-\x7e]/.test(event.clipboardData?.getData("text/plain") ?? "")) {
                          event.preventDefault();
                          setError("Use one line of basic Latin text.");
                          focusLater(() => input);
                        }
                      }}
                    />
                    <Show when={error()}>
                      <span id="editor-field-error" class="editor-text-error" role="alert">
                        {error()}
                      </span>
                    </Show>
                  </span>
                </label>
                <span id="editor-field-input-help" class="editor-text-font">
                  Embedded field · Helvetica 12 pt
                </span>
                <EditorButton type="submit" variant="primary" disabled={saving() || props.disabled}>
                  {saving() ? "Saving…" : "Save answer"}
                </EditorButton>
                <EditorButton disabled={saving()} onClick={finish}>
                  Cancel
                </EditorButton>
                <EditorButton
                  icon="previous"
                  aria-label="Previous field"
                  disabled={saving() || position() <= 0}
                  onClick={() => navigate(-1)}
                />
                <EditorButton
                  icon="next"
                  aria-label="Next field"
                  disabled={saving() || position() >= navigable().length - 1}
                  onClick={() => navigate(1)}
                />
              </form>
            )}
          </Show>
        </div>
      </Portal>
      <div ref={layer} class="editor-field-layer">
        <Show when={props.geometry}>
          <For each={widgets()}>
            {(widget) => (
              <button
                type="button"
                class="editor-field-hit"
                classList={{ "is-selected": selected()?.widgetRef === widget.widgetRef }}
                data-field-ref={widget.fieldRef}
                data-widget-ref={widget.widgetRef}
                aria-label={`${widget.reason ? "Read-only field" : "Fill field"}: ${widget.label}`}
                aria-disabled={!!widget.reason || props.disabled || saving()}
                title={widget.reason ?? widget.label}
                style={style(widget)}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!props.disabled) choose(widget);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    finish();
                  }
                }}
              />
            )}
          </For>
        </Show>
      </div>
    </>
  );
}
