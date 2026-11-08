import { describe, expect, it } from "vitest";
import { isInvalidPDFError, processingError } from "../pdf-errors";

const file = new File(["x"], "broken.pdf");

describe("isInvalidPDFError", () => {
  it("finds pdf.js's invalid-PDF rejection inside a processing error", () => {
    const invalid = Object.assign(new Error("Invalid PDF structure."), {
      name: "InvalidPDFException",
    });
    expect(isInvalidPDFError(processingError("load-pdf-js", file, invalid))).toBe(true);
  });

  it("ignores other load failures", () => {
    expect(isInvalidPDFError(processingError("read-file", file, new Error("denied")))).toBe(false);
    expect(isInvalidPDFError("Invalid PDF")).toBe(false);
  });
});
