import { Effect, Option } from "effect";
import {
  type PDFError,
  PDFPasswordRequiredError,
  type PDFProcessingError,
} from "../types/interfaces";
import { type DocumentKey, makeDocumentStore } from "./document-store";
import { processingError } from "./pdf-errors";
import { PDFReadCache } from "./pdfium/cache";
import { PDFiumClient, PDFiumClientError } from "./pdfium/client";
import type { PDFContentEdit, PDFiumCommands, PDFiumImage, PDFiumPageRef } from "./pdfium/protocol";

type LoadedPDF = { file: File; id: number; count: number; revision: number };
type PageInfo = PDFiumCommands["info"]["output"];
type RenderedPage = PDFiumCommands["render"]["output"];
type PageContent = PDFiumCommands["content"]["output"];

export class PDFService {
  private activeFile: File | null = null;
  private passwords = new Map<File, string>();
  private readonly infoCache = new PDFReadCache<PageInfo>(64 * 1024, 512);
  private readonly contentCache = new PDFReadCache<PageContent>(2 * 1024 * 1024, 24);
  private readonly renderCache = new PDFReadCache<RenderedPage>(24 * 1024 * 1024, 48);
  private readonly inspecting = new Map<string, Promise<PageContent>>();
  private readonly measuring = new Map<string, Promise<PageInfo>>();
  private readonly documents = makeDocumentStore<LoadedPDF>({
    load: (key) => this.loadRecord(key),
    cleanup: (record) =>
      this.command(record.file, "close", async () => {
        this.invalidate(record);
        this.infoCache.invalidate(record.id);
        await this.client.request("close", { id: record.id });
      }),
  });

  constructor(
    readonly client: Pick<PDFiumClient, "request" | "dispose"> &
      Partial<Pick<PDFiumClient, "preload">> = new PDFiumClient()
  ) {}

  preload(): Effect.Effect<void> {
    // Background initialization errors remain visible on the next user operation.
    return Effect.sync(() => {
      try {
        this.client.preload?.();
      } catch {
        /* surfaced by the next command */
      }
    });
  }

  private invalidate(doc: LoadedPDF): void {
    doc.revision++;
    this.contentCache.invalidate(doc.id);
    this.renderCache.invalidate(doc.id);
  }

  private info(doc: LoadedPDF, page: number): Promise<PageInfo> {
    const key = `${doc.id}:${page}`;
    const cached = this.infoCache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.measuring.get(key);
    if (pending) return pending;
    const revision = doc.revision;
    const request = this.client
      .request("info", { id: doc.id, page, rotation: 0 })
      .then((info) => {
        if (doc.revision === revision) this.infoCache.set(key, info, 48);
        return info;
      })
      .finally(() => this.measuring.delete(key));
    this.measuring.set(key, request);
    return request;
  }

  private command<A>(
    file: File,
    operation: string,
    run: (signal: AbortSignal) => Promise<A>
  ): Effect.Effect<A, PDFProcessingError> {
    return Effect.tryPromise({
      try: run,
      catch: (cause) => processingError(operation, file, cause),
    });
  }

  private loadRecord(key: DocumentKey): Effect.Effect<LoadedPDF, PDFError> {
    const password = key.variant.startsWith("password:")
      ? key.variant.slice(9)
      : this.passwords.get(key.file);
    return Effect.tryPromise({
      try: async (signal) => {
        const buffer = await key.file.arrayBuffer();
        if (signal.aborted) throw new Error("PDF loading was cancelled.");
        const result = await this.client.request(
          "open",
          { bytes: new Uint8Array(buffer), password },
          [buffer]
        );
        if (signal.aborted) {
          await this.client.request("close", { id: result.id });
          throw new Error("PDF loading was cancelled.");
        }
        return { ...result, file: key.file, revision: 0 };
      },
      catch: (cause) =>
        cause instanceof PDFiumClientError && cause.password
          ? new PDFPasswordRequiredError(key.file, password ? "wrong-password" : "needs-password")
          : processingError("load-pdf", key.file, cause),
    });
  }

  loadPDF(file: File): Effect.Effect<void, PDFError> {
    const version = this.documents.version(file);
    return this.documents.gate(
      file,
      "load-pdf"
    )(
      this.documents.acquire({ file, variant: "auto" }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (this.documents.isCurrent(file, version)) this.activeFile = file;
          })
        ),
        Effect.asVoid
      )
    );
  }

  loadPDFWithPassword(file: File, password: string): Effect.Effect<void, PDFError> {
    const version = this.documents.version(file);
    return this.documents.gate(
      file,
      "load-pdf-with-password"
    )(
      Effect.suspend(() => {
        const previous = this.passwords.get(file);
        if (previous !== undefined && previous !== password)
          return Effect.fail(new PDFPasswordRequiredError(file, "wrong-password"));
        return this.documents.acquire({ file, variant: `password:${password}` }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (this.documents.isCurrent(file, version)) {
                this.passwords.set(file, password);
                this.activeFile = file;
              }
            })
          ),
          Effect.asVoid
        );
      })
    );
  }

  getPageCount(): number {
    if (!this.activeFile) return 0;
    return Option.match(this.documents.peek(this.activeFile), {
      onNone: () => 0,
      onSome: (doc) => doc.count,
    });
  }

  getPassword(file: File): string | undefined {
    return this.passwords.get(file);
  }

  private withDocument<A>(
    file: File,
    operation: string,
    use: (record: LoadedPDF, signal: AbortSignal) => Promise<A>
  ): Effect.Effect<A, PDFError> {
    return this.documents.track(
      file,
      operation
    )(
      Effect.flatMap(this.documents.acquire({ file, variant: "auto" }), (record) =>
        this.command(file, operation, (signal) => use(record, signal))
      )
    );
  }

  getPageRotation(file: File, pageNumber: number): Effect.Effect<number, PDFError> {
    return this.withDocument(
      file,
      "get-page-rotation",
      async (doc) => (await this.info(doc, pageNumber)).rotation
    );
  }

  getPageSize(file: File, pageNumber: number, rotation = 0) {
    return this.withDocument(file, "get-page-size", async (doc) => {
      const info = await this.info(doc, pageNumber);
      const swap = Math.abs(rotation) % 180 !== 0;
      return {
        width: swap ? info.height : info.width,
        height: swap ? info.width : info.height,
        rotation: info.rotation,
      };
    });
  }

  renderPage(
    file: File,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale = 1.5,
    rotation = 0
  ): Effect.Effect<void, PDFError> {
    return this.withDocument(file, "render-page", async (doc, signal) => {
      const key = `${doc.id}:${pageNumber}:${rotation}:${scale}`;
      const revision = doc.revision;
      let rendered = this.renderCache.get(key);
      if (!rendered) {
        rendered = await this.client.request(
          "render",
          {
            id: doc.id,
            page: pageNumber,
            scale,
            rotation,
          },
          [],
          { signal, priority: Math.min(scale, 1) }
        );
        if (!signal.aborted && doc.revision === revision)
          this.renderCache.set(key, rendered, rendered.pixels.byteLength);
      }
      if (signal.aborted) return;
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not get canvas context.");
      context.putImageData(new ImageData(rendered.pixels, rendered.width, rendered.height), 0, 0);
    });
  }

  getPageContent(file: File, pageNumber: number) {
    return this.withDocument(file, "inspect-page", (doc) => {
      const key = `${doc.id}:${pageNumber}:${doc.revision}`;
      const cached = this.contentCache.get(key);
      if (cached) return Promise.resolve(cached);
      const pending = this.inspecting.get(key);
      if (pending) return pending;
      const revision = doc.revision;
      const request = this.client
        .request("content", { id: doc.id, page: pageNumber })
        .then((content) => {
          if (doc.revision === revision)
            this.contentCache.set(key, content, JSON.stringify(content).length * 2);
          return content;
        })
        .finally(() => this.inspecting.delete(key));
      this.inspecting.set(key, request);
      return request;
    });
  }

  editPage(file: File, pageNumber: number, edit: PDFContentEdit) {
    // Mutations complete before releasing a file. Cancellation cannot undo an already dispatched edit.
    return Effect.uninterruptible(
      this.withDocument(file, "edit-page", async (doc) => {
        this.invalidate(doc);
        try {
          await this.client.request("edit", { id: doc.id, page: pageNumber, edit });
        } finally {
          // Also discard reads dispatched while a mutation was in progress.
          this.invalidate(doc);
        }
      })
    );
  }

  buildPages(
    pages: readonly { sourceFile: File; sourcePageNumber: number; rotation: number }[]
  ): Effect.Effect<Uint8Array, PDFError> {
    const build = Effect.gen({ self: this }, function* () {
      const refs: PDFiumPageRef[] = [];
      for (const page of pages) {
        const doc = yield* this.documents.acquire({ file: page.sourceFile, variant: "auto" });
        refs.push({ document: doc.id, page: page.sourcePageNumber, rotation: page.rotation });
      }
      return yield* this.command(pages[0].sourceFile, "build-pdf", () =>
        this.client.request("build", { pages: refs })
      );
    });
    return [...new Set(pages.map((page) => page.sourceFile))].reduceRight(
      (effect, file) => this.documents.track(file, "build-pdf")(effect),
      build
    );
  }

  imagesToPDF(images: PDFiumImage[], file: File) {
    return this.command(file, "images-to-pdf", () =>
      this.client.request(
        "images",
        { images },
        images.map((image) => image.bytes.buffer)
      )
    );
  }

  releaseFile(file: File): Effect.Effect<void, PDFProcessingError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        if (this.activeFile === file) this.activeFile = null;
        this.passwords.delete(file);
        return this.documents.releaseFile(file);
      })
    );
  }

  reset(): Effect.Effect<void, PDFProcessingError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        this.activeFile = null;
        this.passwords.clear();
        this.infoCache.clear();
        this.contentCache.clear();
        this.renderCache.clear();
        return this.documents.reset;
      })
    );
  }

  dispose(): Effect.Effect<void> {
    return this.documents.dispose().pipe(Effect.ensuring(Effect.sync(() => this.client.dispose())));
  }
}
