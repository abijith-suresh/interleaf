export const socialPreviewSize = { width: 1200, height: 630 };

const currentVersion = 4;

// A new filename lets crawlers fetch the redesign instead of a cached image.
export function socialPreviewFilename(page: string) {
  return `${page}-v${currentVersion}.png`;
}

// Cached page metadata may still reference an earlier image URL.
export function legacySocialPreviewFilenames(page: string) {
  const versioned = Array.from({ length: currentVersion - 2 }, (_, i) => `${page}-v${i + 2}.png`);
  return [`${page}.png`, ...versioned];
}
