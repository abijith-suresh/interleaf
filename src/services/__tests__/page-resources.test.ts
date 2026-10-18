import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type * as pdfjsLib from "pdfjs-dist";
import { describe, expect, vi } from "vitest";
import { PageResources } from "../page-resources";

const makeFile = (name: string): File => new File([name], name, { type: "application/pdf" });

const makeDocument = (page: { cleanup: () => boolean }) =>
  ({ getPage: () => Promise.resolve(page) }) as unknown as pdfjsLib.PDFDocumentProxy;

describe("PageResources", () => {
  it.effect("waits for an interrupted acquisition and cleans the late page", () => {
    const resources = new PageResources();
    const file = makeFile("late.pdf");
    const page = { cleanup: vi.fn(() => true) };
    const pending = Promise.withResolvers<typeof page>();
    const started = Deferred.makeUnsafe<void>();
    const document = {
      getPage: () => {
        Deferred.doneUnsafe(started, Effect.void);
        return pending.promise;
      },
    } as unknown as pdfjsLib.PDFDocumentProxy;

    return Effect.gen(function* () {
      const acquisition = yield* Effect.forkChild(resources.getPage(document, file, 1, "use"));
      yield* Deferred.await(started);
      const interruption = yield* Effect.forkChild(Fiber.interrupt(acquisition));
      yield* Effect.yieldNow;
      expect(page.cleanup).not.toHaveBeenCalled();

      pending.resolve(page);
      yield* Fiber.join(interruption);
      yield* resources.drain(file);
      expect(page.cleanup).toHaveBeenCalledOnce();
    });
  });

  it.effect("finishes one page use and cleanup before starting the next", () => {
    const resources = new PageResources();
    const file = makeFile("shared.pdf");
    const events: string[] = [];
    const page = {
      cleanup: vi.fn(() => {
        events.push("cleanup");
        return true;
      }),
    };
    const document = makeDocument(page);
    const firstStarted = Deferred.makeUnsafe<void>();
    const secondAttempted = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();

    return Effect.gen(function* () {
      // Ready acquisitions make a missing lock observable without scheduler spin loops.
      const firstPage = yield* resources.getPage(document, file, 1, "use");
      const secondPage = yield* resources.getPage(document, file, 1, "use");
      const first = resources.withPageCleanup(file, 1, Effect.succeed(firstPage), () =>
        Effect.gen(function* () {
          events.push("first-start");
          yield* Deferred.succeed(firstStarted, undefined);
          yield* Deferred.await(release);
          events.push("first-end");
        })
      );
      const second = Deferred.succeed(secondAttempted, undefined).pipe(
        Effect.andThen(
          resources.withPageCleanup(file, 1, Effect.succeed(secondPage), () =>
            Effect.sync(() => {
              expect(events).toEqual(["first-start", "first-end", "cleanup"]);
              events.push("second");
            })
          )
        )
      );
      const firstFiber = yield* Effect.forkChild(first);
      yield* Deferred.await(firstStarted);
      const secondFiber = yield* Effect.forkChild(second);
      yield* Deferred.await(secondAttempted);
      yield* Effect.yieldNow;
      expect(events).toEqual(["first-start"]);

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(firstFiber);
      yield* Fiber.join(secondFiber);

      expect(events).toEqual(["first-start", "first-end", "cleanup", "second", "cleanup"]);
    });
  });

  it.effect(
    "waits for deferred cleanup before finishing interruption, reusing the page or draining",
    () => {
      const resources = new PageResources();
      const file = makeFile("deferred.pdf");
      const started = Deferred.makeUnsafe<void>();
      const cleanupStarted = Deferred.makeUnsafe<void>();
      let cleanupReady = false;
      let reused = false;
      const page = {
        cleanup: vi.fn(() => {
          Deferred.doneUnsafe(cleanupStarted, Effect.void);
          return cleanupReady;
        }),
      };
      const document = makeDocument(page);

      return Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          resources.withPageCleanup(file, 1, resources.getPage(document, file, 1, "render"), () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
          )
        );
        yield* Deferred.await(started);
        const interruption = yield* Effect.forkChild(Fiber.interrupt(first));
        yield* Deferred.await(cleanupStarted);
        const second = yield* Effect.forkChild(
          resources.withPageCleanup(file, 1, resources.getPage(document, file, 1, "reuse"), () =>
            Effect.sync(() => {
              reused = true;
            })
          )
        );
        const drain = yield* Effect.forkChild(resources.drain(file));
        yield* TestClock.adjust("100 millis");
        expect(page.cleanup.mock.calls.length).toBeGreaterThan(1);
        expect(interruption.pollUnsafe()).toBeUndefined();
        expect(drain.pollUnsafe()).toBeUndefined();
        expect(reused).toBe(false);

        cleanupReady = true;
        yield* TestClock.adjust("25 millis");
        yield* Fiber.join(interruption);
        yield* Fiber.join(second);
        yield* Fiber.join(drain);
        expect(reused).toBe(true);
      });
    }
  );

  it.effect("keeps access to different pages independent", () => {
    const resources = new PageResources();
    const file = makeFile("shared.pdf");
    const page = { cleanup: () => true };
    const document = makeDocument(page);

    const firstStarted = Deferred.makeUnsafe<void>();
    const holdFirst = Deferred.makeUnsafe<void>();
    let firstFinished = false;

    const first = resources.withPageCleanup(
      file,
      1,
      resources.getPage(document, file, 1, "use"),
      () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(firstStarted, undefined);
          yield* Deferred.await(holdFirst);
          firstFinished = true;
        })
    );
    const second = resources.withPageCleanup(
      file,
      2,
      resources.getPage(document, file, 2, "use"),
      () =>
        Effect.sync(() => {
          expect(firstFinished).toBe(false);
        })
    );

    return Effect.gen(function* () {
      const firstFiber = yield* Effect.forkChild(first);
      yield* Deferred.await(firstStarted);
      yield* second;

      yield* Deferred.succeed(holdFirst, undefined);
      yield* Fiber.join(firstFiber);

      expect(firstFinished).toBe(true);
    });
  });
});
