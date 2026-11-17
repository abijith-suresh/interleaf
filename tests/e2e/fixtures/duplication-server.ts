import { test as base } from "@playwright/test";
import { startDevServer } from "./dev-server";

export const test = base.extend<{}, { url: string }>({
  url: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires fixture destructuring.
    async ({}, use, workerInfo) => {
      const server = await startDevServer("duplication", workerInfo);
      try {
        await use(server.url);
      } finally {
        await server.close();
      }
    },
    { scope: "worker" },
  ],
});
