import type { WorkerInfo } from "@playwright/test";
import { createServer } from "vite";

// Serves a blank page that can import repository modules with real PDF.js and its worker.
export async function startDevServer(name: string, info: WorkerInfo) {
  const server = await createServer({
    configFile: false,
    cacheDir: `node_modules/.vite-${name}/${info.project.name}/${info.workerIndex}`,
    plugins: [
      {
        name: "blank-page",
        configureServer(server) {
          server.middlewares.use("/blank", (_request, response) => {
            response.setHeader("Content-Type", "text/html");
            response.end("<!doctype html><title>Test page</title>");
          });
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { include: ["effect", "pdfjs-dist", "pdf-lib", "fflate"] },
  });
  await server.listen();
  return { url: `${server.resolvedUrls?.local[0]}blank`, close: () => server.close() };
}

export type DevServer = Awaited<ReturnType<typeof startDevServer>>;
