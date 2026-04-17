export type ChangelogEntry = {
  version: string;
  date: string;
  categories: { [category: string]: string[] };
};

/**
 * Parse a KEEP A CHANGELOG formatted markdown string into structured entries.
 *
 * Expected format:
 *   ## [x.y.z] - YYYY-MM-DD
 *   ### Added
 *   - item
 *   - item
 *   ### Changed
 *   - item
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const lines = markdown.split("\n");

  let currentEntry: ChangelogEntry | null = null;
  let currentCategory: string | null = null;

  for (const line of lines) {
    // Version header: ## [0.1.0] - 2026-04-11
    const versionMatch = line.match(
      /^##\s+\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/,
    );
    if (versionMatch) {
      if (currentEntry) {
        entries.push(currentEntry);
      }
      currentEntry = {
        version: versionMatch[1],
        date: versionMatch[2],
        categories: {},
      };
      currentCategory = null;
      continue;
    }

    // Category header: ### Added, ### Changed, etc.
    const categoryMatch = line.match(/^###\s+(.+)$/);
    if (categoryMatch && currentEntry) {
      currentCategory = categoryMatch[1].trim();
      currentEntry.categories[currentCategory] = [];
      continue;
    }

    // List item: - something
    const itemMatch = line.match(/^-\s+(.+)$/);
    if (itemMatch && currentEntry && currentCategory) {
      currentEntry.categories[currentCategory].push(itemMatch[1].trim());
    }
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}
