export const socialPreviewSize = { width: 1200, height: 630 };

// A new filename lets crawlers fetch the redesign instead of a cached image.
export function socialPreviewFilename(page: string) {
  return `${page}-v2.png`;
}
