import type { PDFiumCommand, PDFiumCommands, PDFiumRequest, PDFiumResponse } from "./protocol";

export class PDFiumClientError extends Error {
  constructor(
    message: string,
    readonly password = false
  ) {
    super(message);
  }
}

export interface PDFiumRequestOptions {
  signal?: AbortSignal;
  priority?: number;
}

type PendingRequest = {
  request: PDFiumRequest;
  transfers: Transferable[];
  priority: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

const isRead = (command: PDFiumCommand) => ["info", "content", "render"].includes(command);
const cancelled = () => new DOMException("PDF preview was cancelled.", "AbortError");

export class PDFiumClient {
  private worker: Worker | undefined;
  private sequence = 0;
  private failed: Error | undefined;
  private active: number | undefined;
  private pending = new Map<number, PendingRequest>();
  private queue: number[] = [];

  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  ) {}

  /** Starting the worker also starts same-origin WASM compilation, without reading a file. */
  preload(): void {
    if (this.failed) throw this.failed;
    if (this.worker) return;
    this.worker = this.createWorker();
    this.worker.onmessage = (event: MessageEvent<PDFiumResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.sequence);
      if (!pending || this.active !== response.sequence) return;
      this.pending.delete(response.sequence);
      pending.cleanup();
      if (response.ok) pending.resolve(response.value);
      else pending.reject(new PDFiumClientError(response.message, response.password));
      if (this.active === response.sequence) this.active = undefined;
      this.pump();
    };
    this.worker.onerror = () =>
      this.fail(new Error("PDF processing stopped. Reopen the editor and your files."));
    this.worker.onmessageerror = () =>
      this.fail(new Error("Could not read the PDF worker response."));
  }

  request<K extends PDFiumCommand>(
    command: K,
    input: PDFiumCommands[K]["input"],
    transfers: Transferable[] = [],
    options: PDFiumRequestOptions = {}
  ): Promise<PDFiumCommands[K]["output"]> {
    if (options.signal?.aborted) return Promise.reject(cancelled());
    try {
      this.preload();
    } catch (error) {
      return Promise.reject(error);
    }
    const sequence = ++this.sequence;
    return new Promise<PDFiumCommands[K]["output"]>((resolve, reject) => {
      const abort = () => {
        reject(cancelled());
        // An executing synchronous native call cannot be stopped safely. Queued reads can.
        if (this.active === sequence) return;
        this.pending.get(sequence)?.cleanup();
        this.pending.delete(sequence);
        this.queue = this.queue.filter((queued) => queued !== sequence);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(sequence, {
        request: { sequence, command, input } as PDFiumRequest,
        transfers,
        priority: options.priority ?? (command === "render" ? 0 : 2),
        resolve: (value) => resolve(value as PDFiumCommands[K]["output"]),
        reject,
        cleanup: () => options.signal?.removeEventListener("abort", abort),
      });
      this.queue.push(sequence);
      this.pump();
    });
  }

  private pump(): void {
    if (this.active !== undefined || this.failed || !this.queue.length) return;
    // Reorder reads only before the next mutation. Editing, export, open and close remain barriers.
    let selected = 0;
    const first = this.pending.get(this.queue[0]);
    if (first && isRead(first.request.command)) {
      for (let index = 1; index < this.queue.length; index++) {
        const candidate = this.pending.get(this.queue[index]);
        if (!candidate || !isRead(candidate.request.command)) break;
        if (candidate.priority > (this.pending.get(this.queue[selected])?.priority ?? 0))
          selected = index;
      }
    }
    const [sequence] = this.queue.splice(selected, 1);
    const pending = this.pending.get(sequence);
    if (!pending) return;
    this.active = sequence;
    try {
      this.worker?.postMessage(pending.request, pending.transfers);
    } catch (error) {
      this.active = undefined;
      this.pending.delete(sequence);
      pending.cleanup();
      pending.reject(error instanceof Error ? error : new Error("Could not send PDF command."));
      this.pump();
    }
  }

  private fail(error: Error): void {
    this.failed = error;
    this.worker?.terminate();
    this.worker = undefined;
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
    this.queue = [];
    this.active = undefined;
  }

  dispose(): void {
    this.fail(new Error("The PDF worker was disposed."));
  }
}
