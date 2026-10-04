import { Effect } from "effect";
import { PDFProcessingError } from "../types/interfaces";

export function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.length > 0) return cause;
  return fallback;
}

export function processingError(operation: string, file: File, cause: unknown): PDFProcessingError {
  return new PDFProcessingError({
    operation,
    file,
    cause,
    message: errorMessage(cause, `PDF ${operation} failed.`),
  });
}

export function collectFirstError(
  effects: Iterable<Effect.Effect<void, PDFProcessingError>>
): Effect.Effect<void, PDFProcessingError> {
  return Effect.validate(effects, (effect) => effect, { discard: true }).pipe(
    Effect.mapError((errors) => errors[0])
  );
}

export function continueAfterError(
  accumulator: { current?: PDFProcessingError },
  effect: Effect.Effect<void, PDFProcessingError>
): Effect.Effect<void> {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        accumulator.current ??= error;
      })
    )
  );
}
