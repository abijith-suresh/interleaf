const KB = 1024;
const MB = 1024 * 1024;

type SizeUnit = "B" | "KB" | "MB";

function unitFor(bytes: number): SizeUnit {
  if (bytes < KB) return "B";
  if (bytes < MB) return "KB";
  return "MB";
}

function formatIn(bytes: number, unit: SizeUnit): string {
  if (unit === "B") return `${bytes} B`;
  if (unit === "KB") return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

function formatFileSize(bytes: number): string {
  return formatIn(bytes, unitFor(bytes));
}

/** "1.2 MB → 0.8 MB": both sizes in the larger size's unit, unless that rounds to zero. */
export function formatSizeChange(fromBytes: number, toBytes: number): string {
  const unit = unitFor(Math.max(fromBytes, toBytes));
  const to = formatIn(toBytes, unit);
  return `${formatIn(fromBytes, unit)} → ${toBytes > 0 && /^0(\.0)? /.test(to) ? formatFileSize(toBytes) : to}`;
}

/** Whole-percent reduction; any real reduction reads as at least 1%. */
export function formatSavedPercent(fromBytes: number, toBytes: number): string {
  if (fromBytes <= 0 || toBytes >= fromBytes) return "0%";
  return `${Math.max(1, Math.round((1 - toBytes / fromBytes) * 100))}%`;
}
