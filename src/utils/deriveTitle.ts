const UNTITLED_NOTE = "Untitled note";

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function deriveTitle(body: string) {
  for (const line of body.split(/\r?\n/)) {
    const title = normalizeWhitespace(line.replace(/^#+\s*/, ""));

    if (title) {
      return title.slice(0, 80);
    }
  }

  return UNTITLED_NOTE;
}

export { UNTITLED_NOTE };
