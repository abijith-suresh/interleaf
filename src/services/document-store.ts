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
  cleanupError: PDFProcessingError | undefined;
  fiber: Fiber.Fiber<A, PDFError> | null;
}

interface DocumentStoreState<A> {
  readonly sessionVersion: number;
  readonly resident: ReadonlyArray<FileEntry<A>>;
  readonly loads: ReadonlyArray<InFlightLoad<A>>;
  readonly releaseBarriers: ReadonlyArray<FileEntry<Deferred.Deferred<void, PDFProcessingError>>>;
  readonly resetBarrier: Deferred.Deferred<void, PDFProcessingError> | undefined;
  readonly operationFibers: ReadonlyArray<FileEntry<ReadonlyArray<Fiber.Fiber<unknown, unknown>>>>;
}

type AcquireDecision<A> =
  | { readonly _tag: "barrier"; readonly barrier: Deferred.Deferred<void, PDFProcessingError> }
  | { readonly _tag: "resident"; readonly record: A }
  | { readonly _tag: "inflight"; readonly load: InFlightLoad<A> }
  | { readonly _tag: "start"; readonly load: InFlightLoad<A> };

type LoadPlacement<A> =
  | { readonly _tag: "resident" }
  | { readonly _tag: "duplicate"; readonly record: A }
  | { readonly _tag: "stale" };

type ReleaseDecision<A> =
  | { readonly _tag: "awaitReset"; readonly barrier: Deferred.Deferred<void, PDFProcessingError> }
  | { readonly _tag: "awaitRelease"; readonly barrier: Deferred.Deferred<void, PDFProcessingError> }
  | {
      readonly _tag: "start";
      readonly barrier: Deferred.Deferred<void, PDFProcessingError>;
      readonly loads: ReadonlyArray<InFlightLoad<A>>;
      readonly operations: ReadonlyArray<Fiber.Fiber<unknown, unknown>>;
      readonly record: A | undefined;
    };

type ResetDecision<A> =
  | { readonly _tag: "await"; readonly barrier: Deferred.Deferred<void, PDFProcessingError> }
  | {
      readonly _tag: "start";
      readonly barrier: Deferred.Deferred<void, PDFProcessingError>;
      readonly fileBarriers: ReadonlyArray<Deferred.Deferred<void, PDFProcessingError>>;
      readonly loads: ReadonlyArray<InFlightLoad<A>>;
      readonly operations: ReadonlyArray<Fiber.Fiber<unknown, unknown>>;
      readonly records: ReadonlyArray<A>;
      readonly files: ReadonlyArray<File>;
    };

interface ClearDecision<A> {
  readonly loads: ReadonlyArray<InFlightLoad<A>>;
  readonly operations: ReadonlyArray<Fiber.Fiber<unknown, unknown>>;
  readonly records: ReadonlyArray<A>;
}

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

  const mutate = <B>(
    f: (state: DocumentStoreState<A>) => readonly [B, DocumentStoreState<A>]
  ): B => {
    const [result, next] = f(state);
    state = next;
    return result;
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

  const interruptLoadFiber = (
    load: InFlightLoad<A>,
    fiber: Fiber.Fiber<A, PDFError>
  ): Effect.Effect<void, PDFProcessingError> =>
    Fiber.interrupt(fiber).pipe(
      Effect.andThen(Fiber.await(fiber)),
      Effect.andThen((exit) => {
        const cleanupError = load.cleanupError;
        if (cleanupError) return Effect.fail(cleanupError);
        const error = processingErrorFromExit(exit);
        return error ? Effect.fail(error) : Effect.void;
      })
    );

  const cancelLoad = (load: InFlightLoad<A>): Effect.Effect<void, PDFProcessingError> =>
    Effect.gen(function* () {
      yield* Deferred.fail(load.deferred, releaseErrorFor(load.key.file));
      const fiber = load.fiber ?? (yield* Deferred.await(load.fiberReady));
      yield* interruptLoadFiber(load, fiber);
    });

  const cancelLoads = (
    loads: ReadonlyArray<InFlightLoad<A>>
  ): Effect.Effect<void, PDFProcessingError> =>
    collectFirstError(loads.map((load) => cancelLoad(load)));

  const finishLoad = (load: InFlightLoad<A>, exit: Exit.Exit<A, PDFError>): Effect.Effect<void> =>
    Effect.suspend(() => {
      const placement: LoadPlacement<A> = Exit.isSuccess(exit)
        ? mutate<LoadPlacement<A>>((state) => {
            if (
              state.sessionVersion === load.sessionVersion &&
              (fileVersions.get(load.key.file) ?? 0) === load.fileVersion
            ) {
              const resident = lookupEntry(state.resident, load.key.file);
              if (resident !== undefined) {
                return [{ _tag: "duplicate", record: resident }, state];
              }
              return [
                { _tag: "resident" },
                { ...state, resident: upsertEntry(state.resident, load.key.file, exit.value) },
              ];
            }
            return [{ _tag: "stale" }, state];
          })
        : { _tag: "stale" };

      const cleanup =
        Exit.isSuccess(exit) && placement._tag !== "resident"
          ? hooks.cleanup(exit.value).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  load.cleanupError = error;
                })
              )
            )
          : Effect.void;

      return cleanup.pipe(
        Effect.andThen(
          Effect.sync(() => {
            mutate((state) =>
              state.loads.includes(load)
                ? [undefined, { ...state, loads: state.loads.filter((entry) => entry !== load) }]
                : [undefined, state]
            );
          })
        ),
        Effect.andThen(
          Effect.suspend(() => {
            const cleanupError = load.cleanupError;
            if (cleanupError) return Deferred.fail(load.deferred, cleanupError);
            if (placement._tag === "duplicate") {
              return Deferred.succeed(load.deferred, placement.record);
            }
            if (Exit.isSuccess(exit) && placement._tag === "stale") {
              return Deferred.fail(load.deferred, releaseErrorFor(load.key.file));
            }
            return Deferred.done(load.deferred, exit);
          })
        )
      );
    });

  const startLoad = (load: InFlightLoad<A>): Effect.Effect<void> =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkDetach(
        Effect.suspend(() => hooks.load(load.key)).pipe(
          Effect.onExit((exit) => finishLoad(load, exit))
        )
      );
      load.fiber = Fiber.runIn(scope)(fiber);
      yield* Deferred.succeed(load.fiberReady, fiber);
    });

  const completeRelease = (
    file: File,
    barrier: Deferred.Deferred<void, PDFProcessingError>,
    exit: Exit.Exit<void, PDFProcessingError>
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      mutate((state) =>
        lookupEntry(state.releaseBarriers, file) === barrier
          ? [undefined, { ...state, releaseBarriers: removeEntry(state.releaseBarriers, file) }]
          : [undefined, state]
      );
    }).pipe(Effect.andThen(Deferred.done(barrier, exit)), Effect.asVoid);

  const completeReset = (
    barrier: Deferred.Deferred<void, PDFProcessingError>,
    exit: Exit.Exit<void, PDFProcessingError>
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      mutate((state) =>
        state.resetBarrier === barrier
          ? [undefined, { ...state, resetBarrier: undefined }]
          : [undefined, state]
      );
    }).pipe(Effect.andThen(Deferred.done(barrier, exit)), Effect.asVoid);

  const releaseFile = (file: File): Effect.Effect<void, PDFProcessingError> =>
    Effect.uninterruptible(
      Effect.suspend(() => {
        const decision = mutate<ReleaseDecision<A>>((state) => {
          if (state.resetBarrier) {
            return [{ _tag: "awaitReset", barrier: state.resetBarrier }, state];
          }

          const existingBarrier = lookupEntry(state.releaseBarriers, file);
          if (existingBarrier) {
            return [{ _tag: "awaitRelease", barrier: existingBarrier }, state];
          }

          const barrier = Deferred.makeUnsafe<void, PDFProcessingError>();
          const loads = state.loads.filter((load) => load.key.file === file);
          const operations = lookupEntry(state.operationFibers, file) ?? [];
          const record = lookupEntry(state.resident, file);
          fileVersions.set(file, (fileVersions.get(file) ?? 0) + 1);

          return [
            { _tag: "start", barrier, loads, operations, record },
            {
              ...state,
              releaseBarriers: upsertEntry(state.releaseBarriers, file, barrier),
              resident: removeEntry(state.resident, file),
              loads: state.loads.filter((load) => load.key.file !== file),
              operationFibers: removeEntry(state.operationFibers, file),
            },
          ];
        });

        switch (decision._tag) {
          case "awaitReset":
            return Deferred.await(decision.barrier).pipe(Effect.andThen(releaseFile(file)));
          case "awaitRelease":
            return Deferred.await(decision.barrier);
          case "start": {
            const effects: Array<Effect.Effect<void, PDFProcessingError>> = [
              interruptOperationFibers(decision.operations),
              cancelLoads(decision.loads),
            ];
            if (hooks.drain) effects.push(hooks.drain(file));
            if (decision.record !== undefined) effects.push(hooks.cleanup(decision.record));
            return collectFirstError(effects).pipe(
              Effect.onExit((exit) => completeRelease(file, decision.barrier, exit))
            );
          }
        }
      })
    );

  const reset: Effect.Effect<void, PDFProcessingError> = Effect.uninterruptible(
    Effect.suspend(() => {
      const decision = mutate<ResetDecision<A>>((state) => {
        if (state.resetBarrier) {
          return [{ _tag: "await", barrier: state.resetBarrier }, state];
        }

        const barrier = Deferred.makeUnsafe<void, PDFProcessingError>();
        const files: Array<File> = [];
        const addFile = (file: File): void => {
          if (!files.includes(file)) files.push(file);
        };

        const fileBarriers = state.releaseBarriers.map(([, releaseBarrier]) => releaseBarrier);
        const loads = state.loads;
        const operations = state.operationFibers.flatMap(([, fibers]) => fibers);
        const records = state.resident.map(([, record]) => record);

        for (const load of loads) addFile(load.key.file);
        for (const [file] of state.operationFibers) addFile(file);
        for (const [file] of state.resident) addFile(file);
        for (const [file] of state.releaseBarriers) addFile(file);

        return [
          { _tag: "start", barrier, fileBarriers, loads, operations, records, files },
          {
            ...state,
            sessionVersion: state.sessionVersion + 1,
            resident: [],
            loads: [],
            operationFibers: [],
            resetBarrier: barrier,
          },
        ];
      });

      if (decision._tag === "await") return Deferred.await(decision.barrier);

      const effects: Array<Effect.Effect<void, PDFProcessingError>> = [
        ...decision.fileBarriers.map((fileBarrier) => Deferred.await(fileBarrier)),
        interruptOperationFibers(decision.operations),
        cancelLoads(decision.loads),
      ];
      if (hooks.drain) {
        const drain = hooks.drain;
        effects.push(...decision.files.map((file) => drain(file)));
      }
      effects.push(...decision.records.map((record) => hooks.cleanup(record)));

      return collectFirstError(effects).pipe(
        Effect.onExit((exit) => completeReset(decision.barrier, exit))
      );
    })
  );

  const clear: Effect.Effect<void, PDFProcessingError> = Effect.uninterruptible(
    Effect.suspend(() => {
      const decision = mutate<ClearDecision<A>>((state) => [
        {
          loads: state.loads,
          operations: state.operationFibers.flatMap(([, fibers]) => fibers),
          records: state.resident.map(([, record]) => record),
        },
        {
          ...state,
          sessionVersion: state.sessionVersion + 1,
          resident: [],
          loads: [],
          operationFibers: [],
        },
      ]);

      return collectFirstError([
        interruptOperationFibers(decision.operations),
        cancelLoads(decision.loads),
        ...decision.records.map((record) => hooks.cleanup(record)),
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

        const decision = mutate<AcquireDecision<A>>((state) => {
          const resetBarrier = state.resetBarrier;
          if (resetBarrier) return [{ _tag: "barrier", barrier: resetBarrier }, state];

          const releaseBarrier = lookupEntry(state.releaseBarriers, key.file);
          if (releaseBarrier) return [{ _tag: "barrier", barrier: releaseBarrier }, state];

          const record = lookupEntry(state.resident, key.file);
          if (record !== undefined) return [{ _tag: "resident", record }, state];

          const existing = state.loads.find(
            (load) => load.key.file === key.file && load.key.variant === key.variant
          );
          if (existing) return [{ _tag: "inflight", load: existing }, state];

          const load: InFlightLoad<A> = {
            key,
            sessionVersion: state.sessionVersion,
            fileVersion: fileVersions.get(key.file) ?? 0,
            deferred: Deferred.makeUnsafe<A, PDFError>(),
            fiberReady: Deferred.makeUnsafe<Fiber.Fiber<A, PDFError>>(),
            cleanupError: undefined,
            fiber: null,
          };

          return [
            { _tag: "start", load },
            { ...state, loads: [...state.loads, load] },
          ];
        });

        switch (decision._tag) {
          case "barrier":
            return restore(Deferred.await(decision.barrier)).pipe(
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
          case "resident":
            return Effect.succeed(decision.record);
          case "inflight":
            return restore(Deferred.await(decision.load.deferred));
          case "start":
            return startLoad(decision.load).pipe(
              Effect.andThen(restore(Deferred.await(decision.load.deferred)))
            );
        }
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

          mutate((state) => [
            undefined,
            {
              ...state,
              operationFibers: upsertEntry(state.operationFibers, file, [
                ...(lookupEntry(state.operationFibers, file) ?? []),
                fiber,
              ]),
            },
          ]);

          return Effect.ensuring(
            restore(effect),
            Effect.sync(() => {
              mutate((state) => {
                const remaining = (lookupEntry(state.operationFibers, file) ?? []).filter(
                  (entry) => entry !== fiber
                );
                return [
                  undefined,
                  {
                    ...state,
                    operationFibers:
                      remaining.length === 0
                        ? removeEntry(state.operationFibers, file)
                        : upsertEntry(state.operationFibers, file, remaining),
                  },
                ];
              });
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
