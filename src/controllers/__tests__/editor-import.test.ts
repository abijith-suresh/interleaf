import { describe, expect, it } from "vitest";
import { planUploadGroups } from "../editor-import";

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
