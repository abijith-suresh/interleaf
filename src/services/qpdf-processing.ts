import { Context, Data, Effect, Layer } from "effect";
import { errorMessage } from "./pdf-errors";

export interface QpdfWorkerOptimizeRequest {
  readonly type: "optimize";
  readonly id: string;
  readonly input: ArrayBuffer;
  readonly password?: string;
}

export interface QpdfWorkerDecryptRequest {
  readonly type: "decrypt";
  readonly id: string;
  readonly input: ArrayBuffer;
  readonly password?: string;
}

export type QpdfWorkerRequest = QpdfWorkerOptimizeRequest | QpdfWorkerDecryptRequest;

export interface QpdfWorkerResultResponse {
  readonly type: "result";
  readonly id: string;
  readonly output: ArrayBuffer;
  readonly inputSize: number;
  readonly candidateSize: number;
  readonly reduced: boolean;
}

export interface QpdfWorkerDecryptedResponse {
  readonly type: "decrypted";
  readonly id: string;
  readonly output: ArrayBuffer;
}

export interface QpdfWorkerErrorResponse {
  readonly type: "error";
  readonly id: string;
  readonly code: string;
  readonly message: string;
}

export type QpdfWorkerResponse =
  | QpdfWorkerResultResponse
  | QpdfWorkerDecryptedResponse
  | QpdfWorkerErrorResponse;

export interface QpdfWorkerPort {
  postMessage(message: QpdfWorkerRequest, transfer: Transferable[]): void;
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
  readonly operation: "create-worker" | "optimize" | "decrypt";
  readonly cause: unknown;
  readonly message: string;
}> {}

export interface QpdfProcessingShape {
  readonly optimizeLosslessly: (
    input: Uint8Array,
    password?: string
  ) => Effect.Effect<QpdfOptimizationResult, QpdfProcessingError>;
  // Takes ownership of input: its buffer is transferred to the worker.
  readonly decrypt: (
    input: ArrayBuffer,
    password?: string
  ) => Effect.Effect<Uint8Array<ArrayBuffer>, QpdfProcessingError>;
  readonly close: () => void;
}

export class QpdfProcessing extends Context.Service<QpdfProcessing, QpdfProcessingShape>()(
  "interleaf/QpdfProcessing"
) {}

export interface QpdfProcessingOptions {
  readonly workerUrl: string | URL;
  readonly workerFactory?: QpdfWorkerFactory;
}

function defaultWorkerFactory(workerUrl: string | URL): QpdfWorkerPort {
  return new Worker(workerUrl, { type: "module" });
}

export function makeQpdfProcessing(options: QpdfProcessingOptions): QpdfProcessingShape {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  const activeCancellations = new Set<() => void>();
  let nextRequestId = 0;
  let closed = false;

  type Operation = QpdfWorkerRequest["type"];
  type Completion<A> = (
    response: QpdfWorkerResultResponse | QpdfWorkerDecryptedResponse
  ) => A | undefined;

  const failure = (operation: Operation, cause: unknown, message: string) =>
    Effect.fail(new QpdfProcessingError({ operation, cause, message }));

  const run = <A>(
    operation: Operation,
    input: ArrayBuffer,
    password: string | undefined,
    complete: Completion<A>
  ): Effect.Effect<A, QpdfProcessingError> => {
    if (closed) {
      return failure(
        operation,
        new Error("Qpdf processing has been closed"),
        "Qpdf processing has been closed."
      );
    }

    if (input.byteLength === 0) {
      return failure(operation, new Error("The input PDF is empty"), "The input PDF is empty.");
    }

    return Effect.callback<A, QpdfProcessingError>((resume) => {
      let worker: QpdfWorkerPort;
      try {
        worker = workerFactory(options.workerUrl);
      } catch (cause) {
        resume(
          Effect.fail(
            new QpdfProcessingError({
              operation: "create-worker",
              cause,
              message: errorMessage(cause, "Could not create the qpdf worker."),
            })
          )
        );
        return;
      }
      const id = `qpdf-${++nextRequestId}`;
      let finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        activeCancellations.delete(cancel);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.terminate();
      };
      const finish = (result: Effect.Effect<A, QpdfProcessingError>) => {
        cleanup();
        resume(result);
      };
      const onMessage = (event: MessageEvent<QpdfWorkerResponse>) => {
        const response = event.data;
        if (response.id !== id) return;

        if (response.type === "error") {
          finish(failure(operation, response, response.message));
          return;
        }

        const result = complete(response);
        finish(
          result === undefined
            ? failure(
                operation,
                response,
                `The qpdf worker returned an unexpected ${response.type} response.`
              )
            : Effect.succeed(result)
        );
      };
      const onError = (event: ErrorEvent) => {
        finish(
          failure(
            operation,
            event.error ?? event,
            errorMessage(event.error ?? event.message, "The qpdf worker failed.")
          )
        );
      };

      const cancel = () =>
        finish(
          failure(operation, new Error("Qpdf processing was closed"), "Qpdf processing was closed.")
        );
      activeCancellations.add(cancel);

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);

      const request: QpdfWorkerRequest = {
        type: operation,
        id,
        input,
        ...(password === undefined ? {} : { password }),
      };

      try {
        worker.postMessage(request, [input]);
      } catch (cause) {
        finish(
          failure(
            operation,
            cause,
            errorMessage(cause, "Could not send the PDF to the qpdf worker.")
          )
        );
      }

      return Effect.sync(cleanup);
    });
  };

  return {
    optimizeLosslessly(input, password) {
      // Never transfer the caller's view. A compression operation must not
      // detach bytes that the editor may still need for another operation.
      return run("optimize", input.slice().buffer, password, (response) => {
        if (response.type !== "result") return undefined;
        const output = new Uint8Array(response.output);
        return {
          data: output,
          inputBytes: response.inputSize,
          candidateBytes: response.candidateSize,
          outputBytes: output.byteLength,
          reduced: response.reduced,
        };
      });
    },

    decrypt(input, password) {
      return run("decrypt", input, password, (response) =>
        response.type === "decrypted" ? new Uint8Array(response.output) : undefined
      );
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
