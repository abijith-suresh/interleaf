import { Effect, Fiber } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { answerField } from "../../controllers/editor-field-state";
import { pdfToViewport } from "../../controllers/text-geometry";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { PageGeometry, PageState, PDFFields, TextFieldWidget } from "../../types/interfaces";
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
  focusInput: (input: HTMLElement, reveal?: HTMLElement) => void;
  onChange: (pageId: string, fieldRef: string, value: string) => void;
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
  const trackFocus = () => focusRevision++;
  document.addEventListener("focusin", trackFocus);
  document.addEventListener("pointerdown", trackFocus, true);
  const widgets = createMemo(
    () =>
      fields()?.widgets.filter((widget) => widget.pageNumber === props.page.sourcePageNumber) ?? []
  );
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
    const supported = widgets().filter((widget) => !widget.reason);
    const index = supported.findIndex((widget) => widget.widgetRef === selected()?.widgetRef);
    const next = supported[index + offset];
    if (next) choose(next);
  }
  async function save() {
    const widget = selected();
    if (!widget || saving() || props.disabled) return;
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
      if (disposed || generation !== version) return;
      if (props.disabled) {
        setSaving(false);
        setError("An operation is in progress. Save your answer when it finishes.");
        return;
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
          answerField([props.page], pageId, widget.fieldRef, value)[0].fieldAnswers ?? []
        ),
      };
      ownCommit = commit;
      props.onChange(pageId, widget.fieldRef, value);
      drafts.delete(widget.fieldRef);
      queueMicrotask(() => {
        if (ownCommit === commit) ownCommit = undefined;
      });
      generation++;
      setSelected(undefined);
      setSaving(false);
      props.onClose();
      if (restore) focusLater(() => hit(widget) ?? props.stage);
    } catch (cause) {
      if (disposed || generation !== version) return;
      setSaving(false);
      setError(cause instanceof Error ? cause.message : "Could not save the answer.");
      if (
        revision === focusRevision &&
        owned &&
        (ownedFocus() || document.activeElement === document.body)
      )
        focusLater(() => input);
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
    untrack(() => {
      if (!own) drafts.clear();
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
                  disabled={
                    saving() ||
                    widgets()
                      .filter((w) => !w.reason)
                      .findIndex((w) => w.widgetRef === widget().widgetRef) <= 0
                  }
                  onClick={() => navigate(-1)}
                />
                <EditorButton
                  icon="next"
                  aria-label="Next field"
                  disabled={
                    saving() ||
                    widgets()
                      .filter((w) => !w.reason)
                      .findIndex((w) => w.widgetRef === widget().widgetRef) >=
                      widgets().filter((w) => !w.reason).length - 1
                  }
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
