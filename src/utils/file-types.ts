export type SupportedFileKind = "pdf" | "png" | "jpeg";

export function getSupportedFileKind(file: Pick<File, "name" | "type">): SupportedFileKind | null {
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpeg";

  if (/\.pdf$/i.test(file.name)) return "pdf";
  if (/\.png$/i.test(file.name)) return "png";
  if (/\.jpe?g$/i.test(file.name)) return "jpeg";

  return null;
}
