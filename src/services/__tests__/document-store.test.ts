import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Option, Scheduler } from "effect";
import { describe, expect } from "vitest";
import { PDFProcessingError } from "../../types/interfaces";
import { type DocumentKey, makeDocumentStore } from "../document-store";
import { processingError } from "../pdf-errors";

interface TestRecord {
  readonly id: string;
}

const makeFile = (name: string): File => new File([name], name, { type: "application/pdf" });

const makeKey = (file: File, variant = "auto"): DocumentKey => ({ file, variant });

const makeRecord = (id: string): TestRecord => ({ id });

const schedulerYieldingOnceAt = (budget: number): Scheduler.MixedScheduler => {
  const scheduler = new Scheduler.MixedScheduler("async");
  const yielded = new WeakSet<object>();
  scheduler.shouldYield = (fiber) => {
    if (yielded.has(fiber) || fiber.currentOpCount < budget) return false;
    yielded.add(fiber);
    return true;
  };
  return scheduler;
};

const expectResident = (option: Option.Option<TestRecord>): TestRecord => {
  const record = Option.getOrUndefined(option);
  if (record === undefined) {
    throw new Error("Expected a resident record");
  }
  return record;
};

describe("makeDocumentStore", () => {
  it.effect("deduplicates concurrent acquires for the same key", () => {
    const gate = Deferred.makeUnsafe<TestRecord>();
    let loadCount = 0;
    const store = makeDocumentStore<TestRecord>({
      load: () => {
        loadCount += 1;
        return Deferred.await(gate);
      },
      cleanup: () => Effect.void,
    });
    const key = makeKey(makeFile("dedupe.pdf"));

    return Effect.gen(function* () {
      const first = yield* Effect.forkChild(store.acquire(key));
      const second = yield* Effect.forkChild(store.acquire(key));
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      expect(loadCount).toBe(1);

      yield* Deferred.succeed(gate, makeRecord("deduped"));

      expect((yield* Fiber.join(first)).id).toBe("deduped");
      expect((yield* Fiber.join(second)).id).toBe("deduped");
      expect(loadCount).toBe(1);
    });
  });

  it.effect("keeps a shared load alive when one consumer is interrupted", () => {
    const gate = Deferred.makeUnsafe<TestRecord>();
    const started = Deferred.makeUnsafe<void>();
    let loadCount = 0;
    let cleanupCount = 0;
    const store = makeDocumentStore<TestRecord>({
      load: () => {
        loadCount += 1;
        return Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)));
      },
      cleanup: () =>
        Effect.sync(() => {
          cleanupCount += 1;
        }),
    });
    const key = makeKey(makeFile("shared.pdf"));

    return Effect.gen(function* () {
      const first = yield* Effect.forkChild(store.acquire(key));
      const second = yield* Effect.forkChild(store.acquire(key));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(first);

      yield* Deferred.succeed(gate, makeRecord("shared"));

      expect((yield* Fiber.join(second)).id).toBe("shared");
      expect(loadCount).toBe(1);
      expect(cleanupCount).toBe(0);
    });
  });

  it("releases a load when its first acquire is interrupted during registration", async () => {
    const file = makeFile("interrupted-registration.pdf");
    const store = makeDocumentStore<TestRecord>({
      load: () => Effect.never,
      cleanup: () => Effect.void,
    });
    const scheduler = schedulerYieldingOnceAt(4);
    const acquire = Effect.provideService(
      store.acquire(makeKey(file)),
      Scheduler.Scheduler,
      scheduler
    );
    const fiber = Effect.runFork(acquire);

    await Effect.runPromise(Fiber.interrupt(fiber));

    const result = await Promise.race([
      Effect.runPromise(store.releaseFile(file)).then(() => "released"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 250)),
    ]);
    expect(result).toBe("released");
  });

  it.effect("retains a resident record across sequential acquires", () => {
    let loadCount = 0;
    const store = makeDocumentStore<TestRecord>({
      load: () => {
        loadCount += 1;
        return Effect.succeed(makeRecord("resident"));
      },
      cleanup: () => Effect.void,
    });
    const file = makeFile("resident.pdf");
    const key = makeKey(file);

    return Effect.gen(function* () {
      const first = yield* store.acquire(key);
      const second = yield* store.acquire(key);

      expect(second).toBe(first);
      expect(expectResident(store.peek(file))).toBe(first);
      expect(loadCount).toBe(1);
    });
  });

  it.effect("releases a resident record and cleans it exactly once", () => {
    const cleanups: TestRecord[] = [];
    const drains: File[] = [];
    let loadCount = 0;
    const store = makeDocumentStore<TestRecord>({
      load: () => {
        loadCount += 1;
        return Effect.succeed(makeRecord(`load-${loadCount}`));
      },
      cleanup: (record) =>
        Effect.sync(() => {
          cleanups.push(record);
        }),
      drain: (file) =>
        Effect.sync(() => {
          drains.push(file);
        }),
    });
    const file = makeFile("release.pdf");
    const key = makeKey(file);

    return Effect.gen(function* () {
      const record = yield* store.acquire(key);
      expect(expectResident(store.peek(file))).toBe(record);

      yield* store.releaseFile(file);

      expect(cleanups).toEqual([record]);
      expect(drains).toEqual([file]);
      expect(Option.isNone(store.peek(file))).toBe(true);

      const reloaded = yield* store.acquire(key);
      expect(reloaded.id).toBe("load-2");

      const firstRelease = yield* Effect.forkChild(store.releaseFile(file));
      const secondRelease = yield* Effect.forkChild(store.releaseFile(file));
      yield* Fiber.join(firstRelease);
      yield* Fiber.join(secondRelease);

      expect(cleanups).toEqual([record, reloaded]);
      expect(loadCount).toBe(2);
    });
  });

  it.effect("finishes releasing a resident record when the release fiber is interrupted", () => {
    const cleanupGate = Deferred.makeUnsafe<void>();
    const cleanups: TestRecord[] = [];
    let cleanupStarted = false;
    const store = makeDocumentStore<TestRecord>({
      load: () => Effect.succeed(makeRecord("resident")),
      cleanup: (record) => {
        cleanups.push(record);
        cleanupStarted = true;
        return Deferred.await(cleanupGate);
      },
    });
    const file = makeFile("interrupted-release.pdf");
    const key = makeKey(file);

    return Effect.gen(function* () {
      const record = yield* store.acquire(key);

      const releaseFiber = yield* Effect.forkChild(store.releaseFile(file));
      yield* Effect.yieldNow;
      expect(cleanupStarted).toBe(true);

      let releaseSettled = false;
      const interruptFiber = yield* Effect.forkChild(
        Fiber.interrupt(releaseFiber).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              releaseSettled = true;
            })
          )
        )
      );
      yield* Effect.yieldNow;
      expect(releaseSettled).toBe(false);

      yield* Deferred.succeed(cleanupGate, undefined);
      yield* Fiber.join(interruptFiber);

      expect(releaseSettled).toBe(true);
      expect(cleanups).toEqual([record]);
      expect(Option.isNone(store.peek(file))).toBe(true);
    });
  });

  it.effect("clears residents and in-flight loads without gating new acquires", () => {
    const pendingGate = Deferred.makeUnsafe<TestRecord>();
    const pendingStarted = Deferred.makeUnsafe<void>();
    const cleanupGate = Deferred.makeUnsafe<void>();
    const cleanups: TestRecord[] = [];
    let cleanupStarted = false;
    let interrupted = 0;
    let loadCount = 0;
    const store = makeDocumentStore<TestRecord>({
      load: (key) => {
        loadCount += 1;
        if (key.variant === "pending") {
          return Deferred.succeed(pendingStarted, undefined).pipe(
            Effect.andThen(Deferred.await(pendingGate)),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted += 1;
              })
            )
          );
        }
        return Effect.succeed(makeRecord(`load-${loadCount}`));
      },
      cleanup: (record) => {
        cleanups.push(record);
        cleanupStarted = true;
        return Deferred.await(cleanupGate);
      },
    });
    const residentFile = makeFile("clear-resident.pdf");
    const pendingFile = makeFile("clear-pending.pdf");
    const freshFile = makeFile("clear-fresh.pdf");

    return Effect.gen(function* () {
      const resident = yield* store.acquire(makeKey(residentFile));
      const pending = yield* Effect.forkChild(store.acquire(makeKey(pendingFile, "pending")));
      yield* Deferred.await(pendingStarted);

      const clearFiber = yield* Effect.forkChild(store.clear.pipe(Effect.exit));
      yield* Effect.yieldNow;
      expect(cleanupStarted).toBe(true);

      const fresh = yield* store.acquire(makeKey(freshFile));
      expect(expectResident(store.peek(freshFile))).toBe(fresh);

      const pendingError = yield* pending.pipe(Fiber.join, Effect.flip);
      expect(pendingError).toMatchObject({ operation: "release-file" });
      expect(interrupted).toBe(1);

      yield* Deferred.succeed(cleanupGate, undefined);
      const clearExit = yield* Fiber.join(clearFiber);
      expect(Exit.isSuccess(clearExit)).toBe(true);

      expect(cleanups).toEqual([resident]);
      expect(Option.isNone(store.peek(residentFile))).toBe(true);
      expect(loadCount).toBe(3);
    });
  });

  it.effect("reset interrupts in-flight loads and continues after a cleanup failure", () => {
    const gate = Deferred.makeUnsafe<TestRecord>();
    const loadStarted = Deferred.makeUnsafe<void>();
    const cleanupFailure = processingError(
      "cleanup-record",
      makeFile("cleanup-error.pdf"),
      new Error("cleanup failed")
    );
    const cleanups: TestRecord[] = [];
    let interrupted = 0;
    const store = makeDocumentStore<TestRecord>({
      load: (key) =>
        key.variant === "pending"
          ? Deferred.succeed(loadStarted, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted += 1;
                })
              )
            )
          : Effect.succeed(makeRecord(key.variant)),
      cleanup: (record) => {
        cleanups.push(record);
        return record.id === "failing" ? Effect.fail(cleanupFailure) : Effect.void;
      },
    });
    const failingFile = makeFile("failing.pdf");
    const otherFile = makeFile("other.pdf");
    const pendingFile = makeFile("pending.pdf");

    return Effect.gen(function* () {
      const failing = yield* store.acquire(makeKey(failingFile, "failing"));
      const other = yield* store.acquire(makeKey(otherFile, "other"));
      const pending = yield* Effect.forkChild(store.acquire(makeKey(pendingFile, "pending")));
      yield* Deferred.await(loadStarted);

      const error = yield* store.reset.pipe(Effect.flip);

      expect(error).toBe(cleanupFailure);
      expect(cleanups).toContain(failing);
      expect(cleanups).toContain(other);
      expect(interrupted).toBe(1);

      const pendingError = yield* pending.pipe(Fiber.join, Effect.flip);
      expect(pendingError).toBeInstanceOf(PDFProcessingError);
      expect(pendingError).toMatchObject({ operation: "release-file" });
    });
  });

  it.effect("rejects an acquire that starts while a release is in progress", () => {
    const cleanupGate = Deferred.makeUnsafe<void, PDFProcessingError>();
    let cleanupStarted = false;
    const store = makeDocumentStore<TestRecord>({
      load: () => Effect.succeed(makeRecord("resident")),
      cleanup: () => {
        cleanupStarted = true;
        return Deferred.await(cleanupGate);
      },
    });
    const file = makeFile("barrier.pdf");
    const key = makeKey(file);

    return Effect.gen(function* () {
      yield* store.acquire(key);

      const releaseFiber = yield* Effect.forkChild(store.releaseFile(file));
      yield* Effect.yieldNow;
      expect(cleanupStarted).toBe(true);

      const acquireFiber = yield* Effect.forkChild(store.acquire(key).pipe(Effect.flip));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(cleanupGate, undefined);

      const error = yield* Fiber.join(acquireFiber);
      expect(error).toBeInstanceOf(PDFProcessingError);
      expect(error).toMatchObject({ operation: "document-operation" });

      yield* Fiber.join(releaseFiber);
    });
  });

  it.effect("allows a retry after a failed load", () => {
    const file = makeFile("retry.pdf");
    const key = makeKey(file);
    let attempts = 0;
    const store = makeDocumentStore<TestRecord>({
      load: () => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(processingError("load-source", file, new Error("temporary failure")))
          : Effect.succeed(makeRecord("recovered"));
      },
      cleanup: () => Effect.void,
    });

    return Effect.gen(function* () {
      const firstError = yield* store.acquire(key).pipe(Effect.flip);
      expect(firstError.message).toBe("temporary failure");

      expect((yield* store.acquire(key)).id).toBe("recovered");
      expect(attempts).toBe(2);
    });
  });

  it.effect("rejects an operation created before release that starts after", () => {
    const cleanupGate = Deferred.makeUnsafe<void, PDFProcessingError>();
    let cleanupStarted = false;
    const store = makeDocumentStore<TestRecord>({
      load: () => Effect.succeed(makeRecord("resident")),
      cleanup: () => {
        cleanupStarted = true;
        return Deferred.await(cleanupGate);
      },
    });
    const file = makeFile("gate.pdf");
    const key = makeKey(file);

    return Effect.gen(function* () {
      yield* store.acquire(key);
      const gated = store.gate(file, "render-page")(Effect.succeed("ran"));

      const releaseFiber = yield* Effect.forkChild(store.releaseFile(file));
      yield* Effect.yieldNow;
      expect(cleanupStarted).toBe(true);

      const error = yield* gated.pipe(Effect.flip);
      expect(error).toBeInstanceOf(PDFProcessingError);
      expect(error.operation).toBe("render-page");

      const late = store.gate(file, "load-pdf")(Effect.succeed("late"));
      const lateFiber = yield* Effect.forkChild(late);

      yield* Deferred.succeed(cleanupGate, undefined);

      expect(yield* Fiber.join(lateFiber)).toBe("late");
      yield* Fiber.join(releaseFiber);
    });
  });

  it.effect("returns the resident record after cleaning a duplicate load", () => {
    const firstGate = Deferred.makeUnsafe<TestRecord>();
    const secondGate = Deferred.makeUnsafe<TestRecord>();
    const cleanups: TestRecord[] = [];
    const store = makeDocumentStore<TestRecord>({
      load: (key) =>
        key.variant === "first" ? Deferred.await(firstGate) : Deferred.await(secondGate),
      cleanup: (record) =>
        Effect.sync(() => {
          cleanups.push(record);
        }),
    });
    const file = makeFile("winner.pdf");

    return Effect.gen(function* () {
      const first = yield* Effect.forkChild(store.acquire(makeKey(file, "first")));
      const second = yield* Effect.forkChild(store.acquire(makeKey(file, "second")));
      yield* Effect.yieldNow;

      const winner = makeRecord("winner");
      yield* Deferred.succeed(firstGate, winner);
      expect(yield* Fiber.join(first)).toBe(winner);

      yield* Deferred.succeed(secondGate, makeRecord("loser"));
      expect(yield* Fiber.join(second)).toBe(winner);

      expect(cleanups.map((record) => record.id)).toEqual(["loser"]);
      expect(expectResident(store.peek(file))).toBe(winner);
    });
  });

  it.effect("does not retain a file after its tracked operation completes", () => {
    const drained: File[] = [];
    const store = makeDocumentStore<TestRecord>({
      load: () => Effect.succeed(makeRecord("resident")),
      cleanup: () => Effect.void,
      drain: (file) =>
        Effect.sync(() => {
          drained.push(file);
        }),
    });
    const file = makeFile("finished-operation.pdf");

    return Effect.gen(function* () {
      yield* store.track(file, "inspect")(Effect.void);
      yield* store.reset;

      expect(drained).toEqual([]);
    });
  });

  it("removes a tracked operation interrupted before its body starts", async () => {
    const drained: File[] = [];
    const store = makeDocumentStore<TestRecord>({
      load: () => Effect.never,
      cleanup: () => Effect.void,
      drain: (file) =>
        Effect.sync(() => {
          drained.push(file);
        }),
    });
    const file = makeFile("interrupted-operation.pdf");
    const tracked = store.track(file, "inspect")(Effect.void);
    const scheduler = schedulerYieldingOnceAt(5);
    const fiber = Effect.runFork(Effect.provideService(tracked, Scheduler.Scheduler, scheduler));

    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(store.reset);

    expect(drained).toEqual([]);
  });

  it.effect("dispose clears resident records and closes the store scope", () => {
    const store = makeDocumentStore<TestRecord>({
      load: () => Effect.succeed(makeRecord("resident")),
      cleanup: () => Effect.void,
    });
    const file = makeFile("dispose.pdf");
    const key = makeKey(file);

    return Effect.gen(function* () {
      yield* store.acquire(key);
      expect(Option.isSome(store.peek(file))).toBe(true);

      yield* store.dispose();

      expect(Option.isNone(store.peek(file))).toBe(true);
    });
  });

  it("finishes disposing when interrupted after marking the store disposed", async () => {
    const file = makeFile("interrupted-dispose.pdf");
    let cleaned = false;
    const store = makeDocumentStore<TestRecord>({
      load: () => Effect.succeed(makeRecord("resident")),
      cleanup: () =>
        Effect.sync(() => {
          cleaned = true;
        }),
    });
    await Effect.runPromise(store.acquire(makeKey(file)));

    const scheduler = schedulerYieldingOnceAt(4);
    const fiber = Effect.runFork(
      Effect.provideService(store.dispose(), Scheduler.Scheduler, scheduler)
    );
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(cleaned).toBe(true);
    expect(Option.isNone(store.peek(file))).toBe(true);
  });

  it.effect("fails fast when acquiring after dispose", () => {
    const store = makeDocumentStore<TestRecord>({
      load: () => Effect.succeed(makeRecord("resident")),
      cleanup: () => Effect.void,
    });
    const file = makeFile("disposed-acquire.pdf");

    return Effect.gen(function* () {
      yield* store.dispose();

      const exit = yield* store.acquire(makeKey(file)).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });
});
