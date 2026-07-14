import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFPasswordRequiredError } from "../../types/interfaces";

const decodeData = (value: ArrayBuffer | ArrayBufferView | undefined) => {
  if (!value) {
    return "";
  }

  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(value);
  }

  return new TextDecoder().decode(new Uint8Array(value));
};

const pdfLibLoadMock = vi.fn().mockImplementation(async (buffer: ArrayBuffer, options?: object) => {
  const label = decodeData(buffer);

  if (label.includes("encrypted") && !Reflect.get(options ?? {}, "ignoreEncryption")) {
    throw new Error("PDF is encrypted");
  }

  return {
    getPageCount: vi.fn().mockReturnValue(label.includes("two-pages") ? 2 : 5),
  };
});

const pdfjsGetDocumentMock = vi
  .fn()
  .mockImplementation((options?: { data?: Uint8Array; password?: string }) => {
    const label = decodeData(options?.data);

    if (label.includes("needs-password")) {
      if (!options || options.password === "") {
        return {
          promise: Promise.reject(
            Object.assign(new Error("Password required"), { name: "PasswordException" })
          ),
        };
      }

      if (options.password !== "623") {
        return {
          promise: Promise.reject(
            Object.assign(new Error("Password required"), { name: "PasswordException" })
          ),
        };
      }
    }

    const baseSize = label.includes("wide")
      ? { width: 300, height: 150 }
      : { width: 100, height: 200 };

    return {
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockImplementation(({ scale = 1, rotation = 0 } = {}) => {
            const width = baseSize.width * scale;
            const height = baseSize.height * scale;

            if (rotation === 90 || rotation === 270) {
              return { width: height, height: width };
            }

            return { width, height };
          }),
          render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
        }),
        cleanup: vi.fn().mockResolvedValue(undefined),
      }),
    };
  });

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    load: pdfLibLoadMock,
  },
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: pdfjsGetDocumentMock,
  GlobalWorkerOptions: { workerSrc: "" },
}));

describe("PDFService", () => {
  let PDFService: typeof import("../pdf-service").PDFService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("../pdf-service");
    PDFService = module.PDFService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads an unencrypted PDF and tracks it as active", async () => {
    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });

    await service.loadPDF(file);

    expect(service.getPageCount()).toBe(5);
  });

  it("loads an owner-password encrypted PDF without prompting for a password", async () => {
    const service = new PDFService();
    const file = new File(["owner-encrypted"], "owner-protected.pdf", {
      type: "application/pdf",
    });

    await service.loadPDF(file);

    expect(service.getPageCount()).toBe(5);
  });

  it("requires a password for a user-password encrypted PDF", async () => {
    const service = new PDFService();
    const file = new File(["needs-password encrypted"], "protected.pdf", {
      type: "application/pdf",
    });

    await expect(service.loadPDF(file)).rejects.toEqual(
      expect.objectContaining({
        name: "PDFPasswordRequiredError",
        reason: "needs-password",
        file,
      })
    );
  });

  it("loads an encrypted PDF with the correct password", async () => {
    const service = new PDFService();
    const file = new File(["needs-password encrypted"], "protected.pdf", {
      type: "application/pdf",
    });

    await service.loadPDFWithPassword(file, "623");

    expect(service.getPageCount()).toBe(5);
  });

  it("throws PDFPasswordRequiredError with a wrong password", async () => {
    const service = new PDFService();
    const file = new File(["needs-password encrypted"], "protected.pdf", {
      type: "application/pdf",
    });

    await expect(service.loadPDFWithPassword(file, "wrong")).rejects.toEqual(
      expect.objectContaining({
        name: "PDFPasswordRequiredError",
        reason: "wrong-password",
        file,
      })
    );
  });

  it("renders pages for the requested source file even after another file becomes active", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const portraitFile = new File(["plain"], "portrait.pdf", { type: "application/pdf" });
    const wideFile = new File(["wide two-pages"], "wide.pdf", { type: "application/pdf" });

    await service.loadPDF(portraitFile);
    await service.loadPDF(wideFile);

    const portraitCanvas = document.createElement("canvas");
    const wideCanvas = document.createElement("canvas");

    await Promise.all([
      service.renderPage(portraitFile, 1, portraitCanvas, 1, 0),
      service.renderPage(wideFile, 1, wideCanvas, 1, 0),
    ]);

    expect(portraitCanvas.height).toBeGreaterThan(portraitCanvas.width);
    expect(wideCanvas.width).toBeGreaterThan(wideCanvas.height);
  });

  it("renders a rotated page using the requested file", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });
    await service.loadPDF(file);

    const canvas = document.createElement("canvas");
    await service.renderPage(file, 1, canvas, 1, 90);

    expect(canvas.width).toBeGreaterThan(canvas.height);
  });

  it("resets cached documents and passwords for the session", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["needs-password encrypted"], "protected.pdf", {
      type: "application/pdf",
    });

    await service.loadPDFWithPassword(file, "623");
    const firstCanvas = document.createElement("canvas");
    await service.renderPage(file, 1, firstCanvas, 1, 0);

    service.reset();

    expect(service.getPageCount()).toBe(0);

    const secondCanvas = document.createElement("canvas");
    await expect(service.renderPage(file, 1, secondCanvas, 1, 0)).rejects.toBeInstanceOf(
      PDFPasswordRequiredError
    );
  });
});
