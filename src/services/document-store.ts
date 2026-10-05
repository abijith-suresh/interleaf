import { Cause, Deferred, Effect, Exit, Fiber, Option, Scope } from "effect";
import { type PDFError, PDFProcessingError } from "../types/interfaces";
import { collectFirstError, processingError } from "./pdf-errors";

export interface DocumentKey {
  readonly file: File;
  readonly variant: string;
}

export interface DocumentStoreHooks<A> {
  readonly load: (key: DocumentKey) => Effect.Effect<A, PDFError>;
  readonly cleanup: (record: A) => Effect.Effect<void, PDFProcessingError>;
  readonly drain?: (file: File) => Effect.Effect<void, PDFProcessingError>;
  readonly releaseError?: (file: File) => PDFProcessingError;
}

export interface DocumentVersion {
  readonly session: number;
  readonly file: number;
}

export interface DocumentStore<A> {
  readonly acquire: (key: DocumentKey) => Effect.Effect<A, PDFError>;
  readonly peek: (file: File) => Option.Option<A>;
  readonly version: (file: File) => DocumentVersion;
  readonly isCurrent: (file: File, version: DocumentVersion) => boolean;
  readonly releaseFile: (file: File) => Effect.Effect<void, PDFProcessingError>;
  readonly reset: Effect.Effect<void, PDFProcessingError>;
  readonly clear: Effect.Effect<void, PDFProcessingError>;
  readonly track: (
    file: File,
    operation: string
  ) => <R, E extends PDFError>(
    effect: Effect.Effect<R, E>
  ) => Effect.Effect<R, E | PDFProcessingError>;
  readonly gate: (
    file: File,
    operation: string
  ) => <R, E extends PDFError>(
    effect: Effect.Effect<R, E>
  ) => Effect.Effect<R, E | PDFProcessingError>;
  readonly dispose: () => Effect.Effect<void>;
}

type FileEntry<V> = readonly [File, V];

interface InFlightLoad<A> {
  readonly key: DocumentKey;
  readonly sessionVersion: number;
  readonly fileVersion: number;
  readonly deferred: Deferred.Deferred<A, PDFError>;
  readonly fiberReady: Deferred.Deferred<Fiber.Fiber<A, PDFError>>;
}

interface DocumentStoreState<A> {
  readonly sessionVersion: number;
  readonly resident: ReadonlyArray<FileEntry<A>>;
  readonly loads: ReadonlyArray<InFlightLoad<A>>;
  readonly releaseBarriers: ReadonlyArray<FileEntry<Deferred.Deferred<void, PDFProcessingError>>>;
  readonly resetBarrier: Deferred.Deferred<void, PDFProcessingError> | undefined;
  readonly operationFibers: ReadonlyArray<FileEntry<ReadonlyArray<Fiber.Fiber<unknown, unknown>>>>;
}

type LoadPlacement<A> =
  | { readonly _tag: "resident" }
  | { readonly _tag: "duplicate"; readonly record: A }
  | { readonly _tag: "stale" };

const lookupEntry = <V>(entries: ReadonlyArray<FileEntry<V>>, file: File): V | undefined => {
  for (const [entryFile, value] of entries) {
    if (entryFile === file) return value;
  }
  return undefined;
};

const upsertEntry = <V>(
  entries: ReadonlyArray<FileEntry<V>>,
  file: File,
  value: V
): ReadonlyArray<FileEntry<V>> => {
  const index = entries.findIndex(([entryFile]) => entryFile === file);
  if (index < 0) return [...entries, [file, value]];
  const next = entries.slice();
  next[index] = [file, value];
  return next;
};

const removeEntry = <V>(
  entries: ReadonlyArray<FileEntry<V>>,
  file: File
): ReadonlyArray<FileEntry<V>> => entries.filter(([entryFile]) => entryFile !== file);

const defaultReleaseError = (file: File): PDFProcessingError =>
  new PDFProcessingError({
    operation: "release-file",
    file,
    cause: new Error("The PDF was released before loading completed."),
    message: "The PDF was released before loading completed.",
  });

const processingErrorFromExit = (
  exit: Exit.Exit<unknown, unknown>
): PDFProcessingError | undefined => {
  if (Exit.isSuccess(exit)) return undefined;

  for (const reason of exit.cause.reasons) {
    if (Cause.isFailReason(reason) && reason.error instanceof PDFProcessingError) {
      return reason.error;
    }
  }

  return undefined;
};

export function makeDocumentStore<A>(hooks: DocumentStoreHooks<A>): DocumentStore<A> {
  const scope = Scope.makeUnsafe();
  const fileVersions = new WeakMap<File, number>();
  let disposed = false;
  let state: DocumentStoreState<A> = {
    sessionVersion: 0,
    resident: [],
    loads: [],
    releaseBarriers: [],
    resetBarrier: undefined,
    operationFibers: [],
  };

  const releaseErrorFor = (file: File): PDFProcessingError =>
    (hooks.releaseError ?? defaultReleaseError)(file);

  const interruptOperationFibers = (
    fibers: ReadonlyArray<Fiber.Fiber<unknown, unknown>>
  ): Effect.Effect<void, PDFProcessingError> =>
    collectFirstError(
      fibers.map((fiber) =>
        Fiber.interrupt(fiber).pipe(
          Effect.andThen(Fiber.await(fiber)),
          Effect.andThen((exit) => {
            const error = processingErrorFromExit(exit);
            return error ? Effect.fail(error) : Effect.void;
          })
        )
      )
    );

  const cancelLoad = (load: InFlightLoad<A>): Effect.Effect<void, PDFProcessingError> =>
    Effect.gen(function* () {
      yield* Deferred.fail(load.deferred, releaseErrorFor(load.key.file));
      const fiber = yield* Deferred.await(load.fiberReady);
      yield* interruptOperationFibers([fiber]);
    });

  const cancelLoads = (
    loads: ReadonlyArray<InFlightLoad<A>>
  ): Effect.Effect<void, PDFProcessingError> =>
    collectFirstError(loads.map((load) => cancelLoad(load)));

  const finishLoad = (
    load: InFlightLoad<A>,
    exit: Exit.Exit<A, PDFError>
  ): Effect.Effect<void, PDFProcessingError> =>
    Effect.suspend(() => {
      let placement: LoadPlacement<A> = { _tag: "stale" };
      if (
        Exit.isSuccess(exit) &&
        state.sessionVersion === load.sessionVersion &&
        (fileVersions.get(load.key.file) ?? 0) === load.fileVersion
      ) {
        const resident = lookupEntry(state.resident, load.key.file);
        if (resident !== undefined) {
          placement = { _tag: "duplicate", record: resident };
        } else {
          placement = { _tag: "resident" };
          state = {
            ...state,
            resident: upsertEntry(state.resident, load.key.file, exit.value),
          };
        }
      }

      return Effect.gen(function* () {
        const cleanup = yield* Effect.exit(
          Exit.isSuccess(exit) && placement._tag !== "resident"
            ? hooks.cleanup(exit.value)
            : Effect.void
        );
        state = { ...state, loads: state.loads.filter((entry) => entry !== load) };

        if (Exit.isFailure(cleanup)) {
          yield* Deferred.failCause(load.deferred, cleanup.cause);
        } else if (placement._tag === "duplicate") {
          yield* Deferred.succeed(load.deferred, placement.record);
        } else if (Exit.isSuccess(exit) && placement._tag === "stale") {
          yield* Deferred.fail(load.deferred, releaseErrorFor(load.key.file));
        } else {
          yield* Deferred.done(load.deferred, exit);
        }
        yield* cleanup;
      });
    });

  const startLoad = (load: InFlightLoad<A>): Effect.Effect<void> =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkDetach(
        Effect.suspend(() => hooks.load(load.key)).pipe(
          Effect.onExit((exit) => finishLoad(load, exit))
        )
      );
      yield* Deferred.succeed(load.fiberReady, Fiber.runIn(scope)(fiber));
    });

  const completeRelease = (
    file: File,
    barrier: Deferred.Deferred<void, PDFProcessingError>,
    exit: Exit.Exit<void, PDFProcessingError>
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      if (lookupEntry(state.releaseBarriers, file) === barrier) {
        state = { ...state, releaseBarriers: removeEntry(state.releaseBarriers, file) };
      }
    }).pipe(Effect.andThen(Deferred.done(barrier, exit)), Effect.asVoid);

  const completeReset = (
    barrier: Deferred.Deferred<void, PDFProcessingError>,
    exit: Exit.Exit<void, PDFProcessingError>
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      if (state.resetBarrier === barrier) {
        state = { ...state, resetBarrier: undefined };
      }
    }).pipe(Effect.andThen(Deferred.done(barrier, exit)), Effect.asVoid);

  const releaseFile = (file: File): Effect.Effect<void, PDFProcessingError> =>
    Effect.uninterruptible(
      Effect.suspend(() => {
        if (state.resetBarrier) {
          return Deferred.await(state.resetBarrier).pipe(Effect.andThen(releaseFile(file)));
        }
        const existingBarrier = lookupEntry(state.releaseBarriers, file);
        if (existingBarrier) return Deferred.await(existingBarrier);

        const barrier = Deferred.makeUnsafe<void, PDFProcessingError>();
        const loads = state.loads.filter((load) => load.key.file === file);
        const operations = lookupEntry(state.operationFibers, file) ?? [];
        const record = lookupEntry(state.resident, file);
        fileVersions.set(file, (fileVersions.get(file) ?? 0) + 1);
        state = {
          ...state,
          releaseBarriers: upsertEntry(state.releaseBarriers, file, barrier),
          resident: removeEntry(state.resident, file),
          loads: state.loads.filter((load) => load.key.file !== file),
          operationFibers: removeEntry(state.operationFibers, file),
        };

        const effects: Array<Effect.Effect<void, PDFProcessingError>> = [
          interruptOperationFibers(operations),
          cancelLoads(loads),
        ];
        if (hooks.drain) effects.push(hooks.drain(file));
        if (record !== undefined) effects.push(hooks.cleanup(record));
        return collectFirstError(effects).pipe(
          Effect.onExit((exit) => completeRelease(file, barrier, exit))
        );
      })
    );

  const reset: Effect.Effect<void, PDFProcessingError> = Effect.uninterruptible(
    Effect.suspend(() => {
      if (state.resetBarrier) return Deferred.await(state.resetBarrier);

      const barrier = Deferred.makeUnsafe<void, PDFProcessingError>();
      const files = new Set<File>();
      const fileBarriers = state.releaseBarriers.map(([, releaseBarrier]) => releaseBarrier);
      const loads = state.loads;
      const operations = state.operationFibers.flatMap(([, fibers]) => fibers);
      const records = state.resident.map(([, record]) => record);

      for (const load of loads) files.add(load.key.file);
      for (const [file] of state.operationFibers) files.add(file);
      for (const [file] of state.resident) files.add(file);
      for (const [file] of state.releaseBarriers) files.add(file);

      state = {
        ...state,
        sessionVersion: state.sessionVersion + 1,
        resident: [],
        loads: [],
        operationFibers: [],
        resetBarrier: barrier,
      };

      const effects: Array<Effect.Effect<void, PDFProcessingError>> = [
        ...fileBarriers.map((fileBarrier) => Deferred.await(fileBarrier)),
        interruptOperationFibers(operations),
        cancelLoads(loads),
      ];
      if (hooks.drain) {
        const drain = hooks.drain;
        effects.push(...Array.from(files, (file) => drain(file)));
      }
      effects.push(...records.map((record) => hooks.cleanup(record)));

      return collectFirstError(effects).pipe(Effect.onExit((exit) => completeReset(barrier, exit)));
    })
  );

  const clear: Effect.Effect<void, PDFProcessingError> = Effect.uninterruptible(
    Effect.suspend(() => {
      const loads = state.loads;
      const operations = state.operationFibers.flatMap(([, fibers]) => fibers);
      const records = state.resident.map(([, record]) => record);
      state = {
        ...state,
        sessionVersion: state.sessionVersion + 1,
        resident: [],
        loads: [],
        operationFibers: [],
      };

      return collectFirstError([
        interruptOperationFibers(operations),
        cancelLoads(loads),
        ...records.map((record) => hooks.cleanup(record)),
      ]);
    })
  );

  const acquire = (key: DocumentKey): Effect.Effect<A, PDFError> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        if (disposed) {
          return Effect.fail(
            processingError(
              "document-store",
              key.file,
              new Error("The document store has been disposed.")
            )
          );
        }

        const barrier = state.resetBarrier ?? lookupEntry(state.releaseBarriers, key.file);
        if (barrier) {
          return restore(Deferred.await(barrier)).pipe(
            Effect.andThen(
              Effect.fail(
                processingError(
                  "document-operation",
                  key.file,
                  new Error("The PDF changed before the document operation could start.")
                )
              )
            )
          );
        }

        const record = lookupEntry(state.resident, key.file);
        if (record !== undefined) return Effect.succeed(record);

        const existing = state.loads.find(
          (load) => load.key.file === key.file && load.key.variant === key.variant
        );
        if (existing) return restore(Deferred.await(existing.deferred));

        const load: InFlightLoad<A> = {
          key,
          sessionVersion: state.sessionVersion,
          fileVersion: fileVersions.get(key.file) ?? 0,
          deferred: Deferred.makeUnsafe<A, PDFError>(),
          fiberReady: Deferred.makeUnsafe<Fiber.Fiber<A, PDFError>>(),
        };
        state = { ...state, loads: [...state.loads, load] };
        return startLoad(load).pipe(Effect.andThen(restore(Deferred.await(load.deferred))));
      })
    );

  const peek = (file: File): Option.Option<A> =>
    Option.fromUndefinedOr(lookupEntry(state.resident, file));

  const version = (file: File): DocumentVersion => {
    return {
      session: state.sessionVersion,
      file: fileVersions.get(file) ?? 0,
    };
  };

  const isCurrentVersion = (file: File, documentVersion: DocumentVersion): boolean => {
    return (
      state.sessionVersion === documentVersion.session &&
      (fileVersions.get(file) ?? 0) === documentVersion.file
    );
  };

  const isCurrent = (file: File, sessionVersion: number, fileVersion: number): boolean => {
    return state.sessionVersion === sessionVersion && (fileVersions.get(file) ?? 0) === fileVersion;
  };

  const barrierFor = (file: File): Deferred.Deferred<void, PDFProcessingError> | undefined => {
    return state.resetBarrier ?? lookupEntry(state.releaseBarriers, file);
  };

  const trackWith = <R, E extends PDFError>(
    file: File,
    operation: string,
    sessionVersion: number,
    fileVersion: number,
    effect: Effect.Effect<R, E>
  ): Effect.Effect<R, E | PDFProcessingError> =>
    Effect.withFiber((fiber) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          if (!isCurrent(file, sessionVersion, fileVersion)) {
            return Effect.fail(
              processingError(
                operation,
                file,
                new Error("The PDF changed before the operation started.")
              )
            );
          }

          const barrier = barrierFor(file);
          if (barrier) {
            return restore(
              Deferred.await(barrier).pipe(
                Effect.andThen(trackWith(file, operation, sessionVersion, fileVersion, effect))
              )
            );
          }

          state = {
            ...state,
            operationFibers: upsertEntry(state.operationFibers, file, [
              ...(lookupEntry(state.operationFibers, file) ?? []),
              fiber,
            ]),
          };

          return Effect.ensuring(
            restore(effect),
            Effect.sync(() => {
              const remaining = (lookupEntry(state.operationFibers, file) ?? []).filter(
                (entry) => entry !== fiber
              );
              state = {
                ...state,
                operationFibers:
                  remaining.length === 0
                    ? removeEntry(state.operationFibers, file)
                    : upsertEntry(state.operationFibers, file, remaining),
              };
            })
          );
        })
      )
    );

  const gateWith = <R, E extends PDFError>(
    file: File,
    operation: string,
    sessionVersion: number,
    fileVersion: number,
    effect: Effect.Effect<R, E>
  ): Effect.Effect<R, E | PDFProcessingError> =>
    Effect.suspend(() => {
      if (!isCurrent(file, sessionVersion, fileVersion)) {
        return Effect.fail(
          processingError(
            operation,
            file,
            new Error("The PDF changed before the operation started.")
          )
        );
      }

      const barrier = barrierFor(file);
      if (barrier) {
        return Deferred.await(barrier).pipe(
          Effect.andThen(gateWith(file, operation, sessionVersion, fileVersion, effect))
        );
      }

      return effect;
    });

  const track =
    (file: File, operation: string) =>
    <R, E extends PDFError>(
      effect: Effect.Effect<R, E>
    ): Effect.Effect<R, E | PDFProcessingError> => {
      return trackWith(file, operation, state.sessionVersion, fileVersions.get(file) ?? 0, effect);
    };

  const gate =
    (file: File, operation: string) =>
    <R, E extends PDFError>(
      effect: Effect.Effect<R, E>
    ): Effect.Effect<R, E | PDFProcessingError> => {
      return gateWith(file, operation, state.sessionVersion, fileVersions.get(file) ?? 0, effect);
    };

  const dispose = (): Effect.Effect<void> =>
    Effect.uninterruptible(
      Effect.suspend(() => {
        disposed = true;
        return reset.pipe(
          Effect.catch(() => Effect.void),
          Effect.andThen(Scope.close(scope, Exit.void))
        );
      })
    );

  return {
    acquire,
    peek,
    version,
    isCurrent: isCurrentVersion,
    releaseFile,
    reset,
    clear,
    track,
    gate,
    dispose,
  };
}
