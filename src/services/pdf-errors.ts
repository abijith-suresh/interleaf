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

/** True when pdf.js rejected the bytes as not being a PDF at all. */
export function isInvalidPDFError(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
    if (cause.name === "InvalidPDFException") return true;
    cause = cause.cause;
  }
  return false;
}
