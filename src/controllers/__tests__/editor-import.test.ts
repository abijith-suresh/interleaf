import { describe, expect, it } from "vitest";
import { describeImportOutcome, planUploadGroups } from "../editor-import";

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });
const png = (name: string) => new File(["image"], name, { type: "image/png" });
const jpeg = (name: string) => new File(["image"], name, { type: "image/jpeg" });

describe("planUploadGroups", () => {
  it("keeps adjacent images together and PDFs as separate inputs", () => {
    const files = [png("first.png"), jpeg("second.jpg"), pdf("middle.pdf"), png("last.png")];

    expect(planUploadGroups(files)).toEqual([
      { kind: "images", files: [files[0], files[1]], outputFileName: "interleaf-images-1.pdf" },
      { kind: "pdf", files: [files[2]] },
      { kind: "images", files: [files[3]], outputFileName: "interleaf-images-2.pdf" },
    ]);
  });

  it("uses the default generated name when there is one image group", () => {
    const files = [png("first.png"), jpeg("second.jpeg")];

    expect(planUploadGroups(files)).toEqual([
      {
        kind: "images",
        files,
        outputFileName: "interleaf-images.pdf",
      },
    ]);
  });

  it("ignores unsupported files for callers that plan before validation", () => {
    const files = [pdf("document.pdf"), new File(["text"], "notes.txt", { type: "text/plain" })];

    expect(planUploadGroups(files)).toEqual([{ kind: "pdf", files: [files[0]] }]);
  });
});

describe("describeImportOutcome", () => {
  it("reports nothing when every file opened", () => {
    expect(describeImportOutcome("upload", 2, 2, [])).toBeNull();
  });

  it("counts opened files and names the skipped one", () => {
    expect(
      describeImportOutcome("upload", 3, 2, [{ kind: "invalid-pdf", name: "broken.pdf" }])
    ).toBe("Opened 2 of 3 files. broken.pdf isn't a valid PDF.");
    expect(describeImportOutcome("add", 2, 1, [{ kind: "locked", name: "locked.pdf" }])).toBe(
      "Added 1 of 2 files. locked.pdf is still locked."
    );
  });

  it("lists two skips and counts the rest, including image groups", () => {
    expect(
      describeImportOutcome("upload", 7, 1, [
        { kind: "unsupported", name: "notes.txt" },
        { kind: "load-error", name: "a.pdf", message: "bad xref" },
        { kind: "load-error", name: "b.pdf", message: "" },
        { kind: "image-error", count: 3, message: "Image is too large." },
      ])
    ).toBe(
      "Opened 1 of 7 files. notes.txt isn't a PDF, PNG, or JPEG file. Failed to load a.pdf: bad xref. 4 more files could not be opened."
    );
  });

  it("keeps a single failure's reason and stays quiet after a canceled password", () => {
    expect(describeImportOutcome("upload", 1, 0, [{ kind: "invalid-pdf", name: "x.pdf" }])).toBe(
      "x.pdf isn't a valid PDF."
    );
    expect(
      describeImportOutcome("upload", 2, 0, [
        {
          kind: "image-error",
          count: 2,
          message: "Failed to create a PDF from the selected images.",
        },
      ])
    ).toBe("Could not open 2 files. Failed to create a PDF from the selected images.");
    expect(describeImportOutcome("upload", 1, 0, [{ kind: "locked", name: "x.pdf" }])).toBeNull();
  });
});
