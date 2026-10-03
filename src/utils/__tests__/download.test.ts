import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile, downloadPDF } from "../download";

describe("download utilities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { kind: "PDF", contentType: "application/pdf", suggestedFileName: "custom.pdf" },
    { kind: "ZIP", contentType: "application/zip", suggestedFileName: "pages.zip" },
  ])(
    "downloads $kind bytes with the supplied filename and releases the URL",
    async ({ kind, contentType, suggestedFileName }) => {
      const data = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const url = "blob:interleaf-download";
      const createURL = vi.spyOn(URL, "createObjectURL").mockReturnValue(url);
      const revokeURL = vi.spyOn(URL, "revokeObjectURL");
      let clickedAnchor: HTMLAnchorElement | undefined;
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement
      ) {
        expect(this).toBeInTheDocument();
        expect(this.download).toBe(suggestedFileName);
        expect(this.href).toBe(url);
        expect(revokeURL).not.toHaveBeenCalled();
        clickedAnchor = this;
      });
      const result = { data, suggestedFileName };

      if (kind === "PDF") {
        downloadPDF(result);
      } else {
        downloadFile(result, contentType);
      }

      expect(createURL).toHaveBeenCalledTimes(1);
      const blob = createURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe(contentType);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data);
      expect(click).toHaveBeenCalledTimes(1);
      expect(clickedAnchor).not.toBeInTheDocument();
      expect(revokeURL).toHaveBeenCalledExactlyOnceWith(url);
    }
  );
});
