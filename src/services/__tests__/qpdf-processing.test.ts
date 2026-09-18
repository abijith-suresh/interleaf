import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import {
  makeQpdfProcessing,
  type QpdfWorkerOptimizeRequest,
  type QpdfWorkerPort,
  type QpdfWorkerResponse,
} from "../qpdf-processing";

class FakeWorker implements QpdfWorkerPort {
  request: QpdfWorkerOptimizeRequest | undefined;
  terminated = false;
  private messageListeners = new Set<(event: MessageEvent<QpdfWorkerResponse>) => void>();
  private errorListeners = new Set<(event: ErrorEvent) => void>();

  postMessage(message: QpdfWorkerOptimizeRequest): void {
    this.request = message;
  }

  addEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent<QpdfWorkerResponse>) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEvent<QpdfWorkerResponse>) => void);
    } else {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent<QpdfWorkerResponse>) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: MessageEvent<QpdfWorkerResponse>) => void);
    } else {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: QpdfWorkerResponse): void {
    for (const listener of this.messageListeners) {
      listener(new MessageEvent("message", { data: response }));
    }
  }
}

function makeService(worker: FakeWorker) {
  return makeQpdfProcessing({
    workerUrl: "/qpdf-worker.js",
    workerFactory: () => worker,
  });
}

describe("QpdfProcessing", () => {
  it("copies input bytes before transferring them and returns a smaller candidate", async () => {
    const worker = new FakeWorker();
    const service = makeService(worker);
    const input = new Uint8Array([1, 2, 3, 4]);
    const effect = service.optimizeLosslessly(input, "secret");
    const resultPromise = Effect.runPromise(effect);

    expect(worker.request?.type).toBe("optimize");
    expect(worker.request?.password).toBe("secret");
    expect(new Uint8Array(worker.request?.input ?? new ArrayBuffer(0))).toEqual(input);
    expect(input).toEqual(new Uint8Array([1, 2, 3, 4]));

    worker.respond({
      type: "result",
      id: worker.request?.id ?? "",
      output: new Uint8Array([1, 2]).buffer,
      inputSize: 4,
      candidateSize: 2,
      reduced: true,
    });

    await expect(resultPromise).resolves.toMatchObject({
      inputBytes: 4,
      candidateBytes: 2,
      outputBytes: 2,
      reduced: true,
      data: new Uint8Array([1, 2]),
    });
    expect(worker.terminated).toBe(true);
  });

  it("returns the original-size output when qpdf cannot reduce the file", async () => {
    const worker = new FakeWorker();
    const service = makeService(worker);
    const resultPromise = Effect.runPromise(service.optimizeLosslessly(new Uint8Array([7, 8, 9])));

    worker.respond({
      type: "result",
      id: worker.request?.id ?? "",
      output: new Uint8Array([7, 8, 9]).buffer,
      inputSize: 3,
      candidateSize: 9,
      reduced: false,
    });

    await expect(resultPromise).resolves.toMatchObject({
      inputBytes: 3,
      candidateBytes: 9,
      outputBytes: 3,
      reduced: false,
      data: new Uint8Array([7, 8, 9]),
    });
  });

  it("maps worker failures to a typed Effect error", async () => {
    const worker = new FakeWorker();
    const service = makeService(worker);
    const resultPromise = Effect.runPromise(service.optimizeLosslessly(new Uint8Array([1])));

    worker.respond({
      type: "error",
      id: worker.request?.id ?? "",
      code: "QPDF_EXEC_FAILED",
      message: "Password required",
    });

    await expect(resultPromise).rejects.toMatchObject({
      _tag: "QpdfProcessingError",
      operation: "optimize",
      message: "Password required",
    });
  });

  it("terminates the worker when the Effect is interrupted", async () => {
    const worker = new FakeWorker();
    const service = makeService(worker);
    const fiber = Effect.runFork(service.optimizeLosslessly(new Uint8Array([1])));

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(worker.terminated).toBe(true);
  });
});
