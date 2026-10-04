import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Scheduler } from "effect";
import { afterEach, beforeEach, describe, expect, type Mock, vi } from "vitest";
import type { PDFError, PDFProcessingError } from "../../types/interfaces";
import { type DocumentKey, makeDocumentStore } from "../document-store";
import { processingError } from "../pdf-errors";

type TestRecord = { id: string };
const makeFile = (name = "source.pdf") => new File([name], name, { type: "application/pdf" });
const makeKey = (file: File, variant = "auto"): DocumentKey => ({ file, variant });

// Force the interruption between registration and starting the protected work.
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

describe("makeDocumentStore", () => {
  let file: File;
  let key: DocumentKey;
  let resident: TestRecord;
  let store: ReturnType<typeof makeDocumentStore<TestRecord>>;
  let load: Mock<(key: DocumentKey) => Effect.Effect<TestRecord, PDFError>>;
  let cleanup: Mock<(record: TestRecord) => Effect.Effect<void, PDFProcessingError>>;
  let drain: Mock<(file: File) => Effect.Effect<void, PDFProcessingError>>;

  beforeEach(() => {
    file = makeFile();
    key = makeKey(file);
    resident = { id: "resident" };
    load = vi.fn(() => Effect.succeed(resident));
    cleanup = vi.fn(() => Effect.void);
    drain = vi.fn(() => Effect.void);
    store = makeDocumentStore({ load, cleanup, drain });
  });

  afterEach(async () => {
    await Effect.runPromise(store.dispose());
  });

  it.effect("deduplicates concurrent acquires for the same key", () => {
    const gate = Deferred.makeUnsafe<TestRecord>();
    const started = Deferred.makeUnsafe<void>();
    load.mockReturnValue(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))
    );
    return Effect.gen(function* () {
      const first = yield* Effect.forkChild(store.acquire(key));
      const second = yield* Effect.forkChild(store.acquire(key));
      yield* Deferred.await(started);
      yield* Effect.yieldNow;
      expect(load).toHaveBeenCalledExactlyOnceWith(key);
      yield* Deferred.succeed(gate, resident);
      expect(yield* Fiber.join(first)).toBe(resident);
      expect(yield* Fiber.join(second)).toBe(resident);
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  it.effect("keeps a shared load alive when one consumer is interrupted", () => {
    const gate = Deferred.makeUnsafe<TestRecord>();
    const started = Deferred.makeUnsafe<void>();
    load.mockReturnValue(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))
    );
    return Effect.gen(function* () {
      const first = yield* Effect.forkChild(store.acquire(key));
      const second = yield* Effect.forkChild(store.acquire(key));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(first);
      yield* Deferred.succeed(gate, resident);
      expect(yield* Fiber.join(second)).toBe(resident);
      expect(load).toHaveBeenCalledTimes(1);
      expect(cleanup).not.toHaveBeenCalled();
    });
  });

  it("releases a load interrupted during registration", async () => {
    load.mockReturnValue(Effect.never);
    const fiber = Effect.runFork(
      Effect.provideService(store.acquire(key), Scheduler.Scheduler, schedulerYieldingOnceAt(4))
    );
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(store.releaseFile(file));
  });

  it.effect("reuses residents until release, then reloads and cleans each record once", () => {
    const reloaded = { id: "reloaded" };
    load.mockReturnValueOnce(Effect.succeed(resident)).mockReturnValue(Effect.succeed(reloaded));
    return Effect.gen(function* () {
      expect(yield* store.acquire(key)).toBe(resident);
      expect(yield* store.acquire(key)).toBe(resident);
      expect(Option.getOrUndefined(store.peek(file))).toBe(resident);
      expect(load).toHaveBeenCalledTimes(1);
      yield* store.releaseFile(file);
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(resident);
      expect(drain).toHaveBeenCalledExactlyOnceWith(file);
      expect(Option.isNone(store.peek(file))).toBe(true);
      expect(yield* store.acquire(key)).toBe(reloaded);
      const first = yield* Effect.forkChild(store.releaseFile(file));
      const second = yield* Effect.forkChild(store.releaseFile(file));
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect(cleanup.mock.calls).toEqual([[resident], [reloaded]]);
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  it.effect("finishes cleanup when the release fiber is interrupted", () => {
    const gate = Deferred.makeUnsafe<void>();
    const started = Deferred.makeUnsafe<void>();
    cleanup.mockReturnValue(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))
    );
    return Effect.gen(function* () {
      yield* store.acquire(key);
      const release = yield* Effect.forkChild(store.releaseFile(file));
      yield* Deferred.await(started);
      const interrupt = yield* Effect.forkChild(Fiber.interrupt(release));
      yield* Effect.yieldNow;
      expect(interrupt.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(interrupt);
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(resident);
      expect(Option.isNone(store.peek(file))).toBe(true);
    });
  });

  it.effect("clears residents and pending loads without gating new acquires", () => {
    const pendingFile = makeFile("pending.pdf");
    const freshFile = makeFile("fresh.pdf");
    const fresh = { id: "fresh" };
    const pendingStarted = Deferred.makeUnsafe<void>();
    const cleanupStarted = Deferred.makeUnsafe<void>();
    const releaseCleanup = Deferred.makeUnsafe<void>();
    const interrupted = vi.fn(() => Effect.void);
    load.mockImplementation(({ file: source }) =>
      source === pendingFile
        ? Deferred.succeed(pendingStarted, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(interrupted)
          )
        : Effect.succeed(source === freshFile ? fresh : resident)
    );
    cleanup.mockReturnValue(
      Deferred.succeed(cleanupStarted, undefined).pipe(
        Effect.andThen(Deferred.await(releaseCleanup))
      )
    );
    return Effect.gen(function* () {
      yield* store.acquire(key);
      const pending = yield* Effect.forkChild(store.acquire(makeKey(pendingFile)));
      yield* Deferred.await(pendingStarted);
      const clear = yield* Effect.forkChild(store.clear);
      yield* Deferred.await(cleanupStarted);
      expect(yield* store.acquire(makeKey(freshFile))).toBe(fresh);
      expect(Option.getOrUndefined(store.peek(freshFile))).toBe(fresh);
      expect(yield* pending.pipe(Fiber.join, Effect.flip)).toMatchObject({
        operation: "release-file",
      });
      expect(interrupted).toHaveBeenCalledTimes(1);
      yield* Deferred.succeed(releaseCleanup, undefined);
      yield* Fiber.join(clear);
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(resident);
      expect(Option.isNone(store.peek(file))).toBe(true);
      expect(load).toHaveBeenCalledTimes(3);
    });
  });

  it.effect("reset interrupts loads and cleans every resident after a cleanup failure", () => {
    const otherFile = makeFile("other.pdf");
    const pendingFile = makeFile("pending.pdf");
    const other = { id: "other" };
    const started = Deferred.makeUnsafe<void>();
    const interrupted = vi.fn(() => Effect.void);
    const failure = processingError("cleanup-record", file, new Error("cleanup failed"));
    load.mockImplementation(({ file: source }) =>
      source === pendingFile
        ? Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(interrupted)
          )
        : Effect.succeed(source === otherFile ? other : resident)
    );
    cleanup.mockImplementation((record) =>
      record === resident ? Effect.fail(failure) : Effect.void
    );
    return Effect.gen(function* () {
      yield* store.acquire(key);
      yield* store.acquire(makeKey(otherFile));
      const pending = yield* Effect.forkChild(store.acquire(makeKey(pendingFile)));
      yield* Deferred.await(started);
      expect(yield* store.reset.pipe(Effect.flip)).toBe(failure);
      expect(cleanup.mock.calls).toEqual([[resident], [other]]);
      expect(interrupted).toHaveBeenCalledTimes(1);
      expect(yield* pending.pipe(Fiber.join, Effect.flip)).toMatchObject({
        operation: "release-file",
      });
    });
  });

  it.effect("rejects an acquire started during release", () => {
    const gate = Deferred.makeUnsafe<void>();
    const started = Deferred.makeUnsafe<void>();
    cleanup.mockReturnValue(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))
    );
    return Effect.gen(function* () {
      yield* store.acquire(key);
      const release = yield* Effect.forkChild(store.releaseFile(file));
      yield* Deferred.await(started);
      const acquire = yield* Effect.forkChild(store.acquire(key).pipe(Effect.flip));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(gate, undefined);
      expect(yield* Fiber.join(acquire)).toMatchObject({
        _tag: "PDFProcessingError",
        operation: "document-operation",
      });
      yield* Fiber.join(release);
    });
  });

  it.effect("allows a retry after a failed load", () => {
    const failure = processingError("load-source", file, new Error("temporary failure"));
    load.mockReturnValueOnce(Effect.fail(failure));
    return Effect.gen(function* () {
      expect(yield* store.acquire(key).pipe(Effect.flip)).toBe(failure);
      expect(yield* store.acquire(key)).toBe(resident);
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  it.effect("rejects stale gated work and allows work created during release", () => {
    const gate = Deferred.makeUnsafe<void>();
    const started = Deferred.makeUnsafe<void>();
    cleanup.mockReturnValue(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))
    );
    return Effect.gen(function* () {
      yield* store.acquire(key);
      const stale = store.gate(file, "render-page")(Effect.succeed("ran"));
      const release = yield* Effect.forkChild(store.releaseFile(file));
      yield* Deferred.await(started);
      expect(yield* stale.pipe(Effect.flip)).toMatchObject({
        _tag: "PDFProcessingError",
        operation: "render-page",
      });
      const late = yield* Effect.forkChild(store.gate(file, "load-pdf")(Effect.succeed("late")));
      yield* Deferred.succeed(gate, undefined);
      expect(yield* Fiber.join(late)).toBe("late");
      yield* Fiber.join(release);
    });
  });

  it.effect("cleans a duplicate load and returns the winning resident", () => {
    const firstGate = Deferred.makeUnsafe<TestRecord>();
    const secondGate = Deferred.makeUnsafe<TestRecord>();
    const duplicate = { id: "duplicate" };
    load.mockImplementation(({ variant }) =>
      Deferred.await(variant === "first" ? firstGate : secondGate)
    );
    return Effect.gen(function* () {
      const first = yield* Effect.forkChild(store.acquire(makeKey(file, "first")));
      const second = yield* Effect.forkChild(store.acquire(makeKey(file, "second")));
      yield* Deferred.succeed(firstGate, resident);
      expect(yield* Fiber.join(first)).toBe(resident);
      yield* Deferred.succeed(secondGate, duplicate);
      expect(yield* Fiber.join(second)).toBe(resident);
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(duplicate);
      expect(Option.getOrUndefined(store.peek(file))).toBe(resident);
    });
  });

  it.effect("does not retain a file after its tracked operation completes", () =>
    Effect.gen(function* () {
      yield* store.track(file, "inspect")(Effect.void);
      yield* store.reset;
      expect(drain).not.toHaveBeenCalled();
    })
  );

  it("removes a tracked operation interrupted before its body starts", async () => {
    const tracked = store.track(file, "inspect")(Effect.void);
    const fiber = Effect.runFork(
      Effect.provideService(tracked, Scheduler.Scheduler, schedulerYieldingOnceAt(5))
    );
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(store.reset);
    expect(drain).not.toHaveBeenCalled();
  });

  it.effect("disposes residents and rejects subsequent acquires", () =>
    Effect.gen(function* () {
      yield* store.acquire(key);
      yield* store.dispose();
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(resident);
      expect(Option.isNone(store.peek(file))).toBe(true);
      expect(yield* store.acquire(key).pipe(Effect.flip)).toMatchObject({
        _tag: "PDFProcessingError",
        operation: "document-store",
      });
    })
  );

  it("finishes disposing when interrupted after marking the store disposed", async () => {
    await Effect.runPromise(store.acquire(key));
    const fiber = Effect.runFork(
      Effect.provideService(store.dispose(), Scheduler.Scheduler, schedulerYieldingOnceAt(4))
    );
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(resident);
    expect(Option.isNone(store.peek(file))).toBe(true);
  });
});
