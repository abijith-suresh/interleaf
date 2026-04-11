import { UNTITLED_NOTE } from "@/utils/deriveTitle";

function getFirstLine(body: string) {
  const firstNewlineIndex = body.search(/\r?\n/);

  return firstNewlineIndex === -1 ? body : body.slice(0, firstNewlineIndex);
}

function stripLeadingMarkdown(value: string) {
  return value.replace(/^[#*\->_ ]+/, "");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function deriveSlug(body: string, fallback = UNTITLED_NOTE) {
  const source = stripLeadingMarkdown(getFirstLine(body)).trim().slice(0, 30);
  const slug = slugify(source || fallback);

  return slug || slugify(fallback) || "untitled-note";
}
