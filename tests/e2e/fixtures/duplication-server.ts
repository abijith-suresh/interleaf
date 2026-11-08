import { test as base } from "@playwright/test";
import { createServer } from "vite";

export const test = base.extend<{}, { url: string }>({
  url: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires fixture destructuring.
    async ({}, use, workerInfo) => {
      const server = await createServer({
        configFile: false,
        cacheDir: `node_modules/.vite-duplication/${workerInfo.project.name}/${workerInfo.workerIndex}`,
        plugins: [
          {
            name: "duplication-fixture",
            configureServer(server) {
              server.middlewares.use("/duplicate-test", (_request, response) => {
                response.setHeader("Content-Type", "text/html");
                response.end("<!doctype html><title>Duplication export inspection</title>");
              });
            },
          },
        ],
        server: { host: "127.0.0.1", port: 0 },
        optimizeDeps: { include: ["pdfjs-dist", "pdf-lib", "fflate"] },
      });
      await server.listen();
      try {
        await use(server.resolvedUrls?.local[0] ?? "");
      } finally {
        await server.close();
      }
    },
    { scope: "worker" },
  ],
});
