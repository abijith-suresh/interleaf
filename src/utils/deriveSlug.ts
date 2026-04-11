import { deriveTitle, UNTITLED_NOTE } from "@/utils/deriveTitle";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function deriveSlug(body: string, fallback = UNTITLED_NOTE) {
  const title = deriveTitle(body);
  const slug = slugify(title === UNTITLED_NOTE ? fallback : title);

  return slug || slugify(fallback) || "untitled-note";
}
