import { describe, expect, it } from "vitest";
import { legacySocialPreviewFilenames, socialPreviewFilename } from "../social-preview";

describe("social preview filenames", () => {
  it("keeps every earlier image URL as an alias of the current one", () => {
    const current = socialPreviewFilename("faq");
    const legacy = legacySocialPreviewFilenames("faq");

    expect(current).toBe("faq-v4.png");
    expect(legacy).toEqual(["faq.png", "faq-v2.png", "faq-v3.png"]);
    expect(legacy).not.toContain(current);
  });
});
