const UNTITLED_NOTE = "Untitled note";

function getFirstLine(body: string) {
  const firstNewlineIndex = body.search(/\r?\n/);

  return firstNewlineIndex === -1 ? body : body.slice(0, firstNewlineIndex);
}

function stripLeadingMarkdown(value: string) {
  return value.replace(/^[#*\->_ ]+/, "");
}

export function deriveTitle(body: string) {
  const title = stripLeadingMarkdown(getFirstLine(body)).trim();

  if (!title) {
    return UNTITLED_NOTE;
  }

  return title.slice(0, 40);
}

export { UNTITLED_NOTE };
