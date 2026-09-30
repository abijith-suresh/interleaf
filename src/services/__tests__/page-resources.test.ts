import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import type * as pdfjsLib from "pdfjs-dist";
import { describe, expect } from "vitest";
import { PageResources } from "../page-resources";

const makeFile = (name: string): File => new File([name], name, { type: "application/pdf" });

const makeDocument = (page: { cleanup: () => boolean }) =>
  ({ getPage: () => Promise.resolve(page) }) as unknown as pdfjsLib.PDFDocumentProxy;

describe("PageResources", () => {
  it.effect("serializes page access so cleanup cannot interrupt a concurrent use", () => {
    const resources = new PageResources();
    const file = makeFile("shared.pdf");
    const page = { cleanup: () => true };
    const document = makeDocument(page);

    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    let activeUses = 0;
    let maxConcurrentUses = 0;
    let secondRan = false;

    const first = resources.withPageCleanup(
      file,
      1,
      resources.getPage(document, file, 1, "use"),
      () =>
        Effect.gen(function* () {
          activeUses += 1;
          maxConcurrentUses = Math.max(maxConcurrentUses, activeUses);
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          activeUses -= 1;
        })
    );
    const second = resources.withPageCleanup(
      file,
      1,
      resources.getPage(document, file, 1, "use"),
      () =>
        Effect.sync(() => {
          secondRan = true;
        })
    );

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.all([first, second], { concurrency: 2, discard: true })
      );

      yield* Deferred.await(started);
      for (let i = 0; i < 50; i += 1) {
        yield* Effect.yieldNow;
      }

      expect(secondRan).toBe(false);
      expect(maxConcurrentUses).toBe(1);

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(fiber);

      expect(secondRan).toBe(true);
      expect(maxConcurrentUses).toBe(1);
    });
  });

  it.effect("keeps access to different pages independent", () => {
    const resources = new PageResources();
    const file = makeFile("shared.pdf");
    const page = { cleanup: () => true };
    const document = makeDocument(page);

    const holdFirst = Deferred.makeUnsafe<void>();
    let secondRan = false;

    const first = resources.withPageCleanup(
      file,
      1,
      resources.getPage(document, file, 1, "use"),
      () => Deferred.await(holdFirst)
    );
    const second = resources.withPageCleanup(
      file,
      2,
      resources.getPage(document, file, 2, "use"),
      () =>
        Effect.sync(() => {
          secondRan = true;
        })
    );

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.all([first, second], { concurrency: 2, discard: true })
      );

      yield* Deferred.succeed(holdFirst, undefined);
      yield* Fiber.join(fiber);

      expect(secondRan).toBe(true);
    });
  });
});
