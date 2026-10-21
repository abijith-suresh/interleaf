/** LRU entries are bounded by both count and estimated retained bytes. */
export class PDFReadCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly maxEntries: number
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    this.remove(key);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }

  invalidate(document: number): void {
    for (const key of this.entries.keys()) if (key.startsWith(`${document}:`)) this.remove(key);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  private remove(key: string): void {
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.entries.delete(key);
  }
}
