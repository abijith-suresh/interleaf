import type { PDFiumCommand, PDFiumCommands, PDFiumResponse } from "./protocol";

export class PDFiumClientError extends Error {
  constructor(
    message: string,
    readonly password = false
  ) {
    super(message);
  }
}

export class PDFiumClient {
  private worker: Worker | undefined;
  private sequence = 0;
  private failed: Error | undefined;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  ) {}

  request<K extends PDFiumCommand>(
    command: K,
    input: PDFiumCommands[K]["input"],
    transfers: Transferable[] = []
  ): Promise<PDFiumCommands[K]["output"]> {
    if (this.failed) return Promise.reject(this.failed);
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.onmessage = (event: MessageEvent<PDFiumResponse>) => {
        const response = event.data;
        const pending = this.pending.get(response.sequence);
        if (!pending) return;
        this.pending.delete(response.sequence);
        if (response.ok) pending.resolve(response.value);
        else pending.reject(new PDFiumClientError(response.message, response.password));
      };
      this.worker.onerror = () =>
        this.fail(new Error("PDF processing stopped. Reopen the editor and your files."));
      this.worker.onmessageerror = () =>
        this.fail(new Error("Could not read the PDF worker response."));
    }
    const sequence = ++this.sequence;
    return new Promise<PDFiumCommands[K]["output"]>((resolve, reject) => {
      this.pending.set(sequence, {
        resolve: (value) => resolve(value as PDFiumCommands[K]["output"]),
        reject,
      });
      try {
        this.worker?.postMessage({ sequence, command, input }, transfers);
      } catch (error) {
        this.pending.delete(sequence);
        reject(error);
      }
    });
  }

  private fail(error: Error): void {
    this.failed = error;
    this.worker?.terminate();
    this.worker = undefined;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  dispose(): void {
    this.fail(new Error("The PDF worker was disposed."));
  }
}
