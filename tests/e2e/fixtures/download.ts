import { readFile } from "node:fs/promises";
import type { Download, Page } from "@playwright/test";

export async function captureDownload(page: Page, action: () => Promise<unknown>) {
  const pending = page.waitForEvent("download");
  await action();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("Missing download");
  return { download, bytes: await readFile(path) };
}

export async function saveDownload(download: Download, path: string) {
  await download.saveAs(path);
  return readFile(path);
}
