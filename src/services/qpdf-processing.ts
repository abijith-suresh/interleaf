import { Context, Data, Effect, Layer } from "effect";

export interface QpdfWorkerOptimizeRequest {
  readonly type: "optimize";
  readonly id: string;
  readonly input: ArrayBuffer;
  readonly password?: string;
}

export interface QpdfWorkerResultResponse {
  readonly type: "result";
  readonly id: string;
  readonly output: ArrayBuffer;
  readonly inputSize: number;
  readonly candidateSize: number;
  readonly reduced: boolean;
}

export interface QpdfWorkerErrorResponse {
  readonly type: "error";
  readonly id: string;
  readonly code: string;
  readonly message: string;
}

export type QpdfWorkerResponse = QpdfWorkerResultResponse | QpdfWorkerErrorResponse;

export interface QpdfWorkerPort {
  postMessage(message: QpdfWorkerOptimizeRequest, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<QpdfWorkerResponse>) => void
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<QpdfWorkerResponse>) => void
  ): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export type QpdfWorkerFactory = (workerUrl: string | URL) => QpdfWorkerPort;

export interface QpdfOptimizationResult {
  readonly data: Uint8Array;
  readonly inputBytes: number;
  readonly candidateBytes: number;
  readonly outputBytes: number;
  readonly reduced: boolean;
}

export class QpdfProcessingError extends Data.TaggedError("QpdfProcessingError")<{
  readonly operation: "create-worker" | "optimize";
  readonly cause: unknown;
  readonly message: string;
}> {}

export interface QpdfProcessingShape {
  readonly optimizeLosslessly: (
    input: Uint8Array,
    password?: string
  ) => Effect.Effect<QpdfOptimizationResult, QpdfProcessingError>;
  readonly close: () => void;
}

export class QpdfProcessing extends Context.Service<QpdfProcessing, QpdfProcessingShape>()(
  "interleaf/QpdfProcessing"
) {}

export interface QpdfProcessingOptions {
  readonly workerUrl: string | URL;
  readonly workerFactory?: QpdfWorkerFactory;
}

function messageFromCause(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : typeof cause === "string" && cause.length > 0
      ? cause
      : fallback;
}

function defaultWorkerFactory(workerUrl: string | URL): QpdfWorkerPort {
  return new Worker(workerUrl, { type: "module" });
}

export function makeQpdfProcessing(options: QpdfProcessingOptions): QpdfProcessingShape {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  const activeCancellations = new Set<() => void>();
  let nextRequestId = 0;
  let closed = false;

  return {
    optimizeLosslessly(input, password) {
      if (closed) {
        return Effect.fail(
          new QpdfProcessingError({
            operation: "optimize",
            cause: new Error("Qpdf processing has been closed"),
            message: "Qpdf processing has been closed.",
          })
        );
      }

      if (input.byteLength === 0) {
        return Effect.fail(
          new QpdfProcessingError({
            operation: "optimize",
            cause: new Error("The input PDF is empty"),
            message: "The input PDF is empty.",
          })
        );
      }

      return Effect.callback<QpdfOptimizationResult, QpdfProcessingError>((resume) => {
        let worker: QpdfWorkerPort;
        try {
          worker = workerFactory(options.workerUrl);
        } catch (cause) {
          resume(
            Effect.fail(
              new QpdfProcessingError({
                operation: "create-worker",
                cause,
                message: messageFromCause(cause, "Could not create the qpdf worker."),
              })
            )
          );
          return;
        }
        const id = `qpdf-${++nextRequestId}`;
        let finished = false;
        let cancel: (() => void) | undefined;
        const cleanup = () => {
          if (finished) return;
          finished = true;
          if (cancel) activeCancellations.delete(cancel);
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          worker.terminate();
        };
        const finish = (result: Effect.Effect<QpdfOptimizationResult, QpdfProcessingError>) => {
          cleanup();
          resume(result);
        };
        const onMessage = (event: MessageEvent<QpdfWorkerResponse>) => {
          const response = event.data;
          if (response.id !== id) return;

          if (response.type === "error") {
            finish(
              Effect.fail(
                new QpdfProcessingError({
                  operation: "optimize",
                  cause: response,
                  message: response.message,
                })
              )
            );
            return;
          }

          const output = new Uint8Array(response.output);
          finish(
            Effect.succeed({
              data: output,
              inputBytes: response.inputSize,
              candidateBytes: response.candidateSize,
              outputBytes: output.byteLength,
              reduced: response.reduced,
            })
          );
        };
        const onError = (event: ErrorEvent) => {
          finish(
            Effect.fail(
              new QpdfProcessingError({
                operation: "optimize",
                cause: event.error ?? event,
                message: messageFromCause(event.error ?? event.message, "The qpdf worker failed."),
              })
            )
          );
        };

        cancel = () =>
          finish(
            Effect.fail(
              new QpdfProcessingError({
                operation: "optimize",
                cause: new Error("Qpdf processing was closed"),
                message: "Qpdf processing was closed.",
              })
            )
          );
        activeCancellations.add(cancel);

        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);

        // Never transfer the caller's view. A compression operation must not
        // detach bytes that the editor may still need for another operation.
        const transferableInput = input.slice();
        const request: QpdfWorkerOptimizeRequest = {
          type: "optimize",
          id,
          input: transferableInput.buffer,
          ...(password === undefined ? {} : { password }),
        };

        try {
          worker.postMessage(request, [transferableInput.buffer]);
        } catch (cause) {
          finish(
            Effect.fail(
              new QpdfProcessingError({
                operation: "optimize",
                cause,
                message: messageFromCause(cause, "Could not send the PDF to the qpdf worker."),
              })
            )
          );
        }

        return Effect.sync(cleanup);
      });
    },

    close() {
      closed = true;
      for (const cancel of [...activeCancellations]) {
        cancel();
      }
    },
  };
}

export function makeQpdfProcessingLayer(
  options: QpdfProcessingOptions
): Layer.Layer<QpdfProcessing> {
  return Layer.effect(
    QpdfProcessing,
    Effect.acquireRelease(
      Effect.sync(() => makeQpdfProcessing(options)),
      (service) => Effect.sync(service.close)
    )
  );
}
