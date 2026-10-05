import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
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
