import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type BrowserContext, test as base, expect, type Request } from "@playwright/test";

async function staticPaths(directory = "dist", prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) return staticPaths(join(directory, entry.name), path);
        if (!entry.isFile()) return [];
        return path.endsWith("/index.html")
          ? [path, path.slice(0, -10), path.slice(0, -11) || "/"]
          : [path];
      })
    )
  ).flat();
}

// Install before navigation. Context routing includes subframes and observable dedicated-worker
// requests. Service workers are blocked in these fresh contexts because they can bypass routes.
// This does not audit production service workers, browser background traffic, every input, or
// third-party library internals. Synthetic controls live in a separate spec/context from the app flows.
export async function observePrivacy(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const assets = new Set(await staticPaths());
  const requests: Request[] = [];
  const forbidden = new Set<Request>();
  const blocked = new Set<Request>();
  const sockets: string[] = [];
  const blockedSockets: string[] = [];
  const allowed = (request: Request) => {
    const url = new URL(request.url());
    if (url.protocol === "blob:" || url.protocol === "data:") return true;
    return (
      url.origin === origin &&
      ["GET", "HEAD"].includes(request.method()) &&
      request.postDataBuffer() === null &&
      !url.search &&
      assets.has(url.pathname)
    );
  };
  context.on("request", (request) => {
    requests.push(request);
    if (!allowed(request)) forbidden.add(request);
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (allowed(request)) return route.continue();
    // Keep attempts even when abort prevents any upload or third-party connection.
    forbidden.add(request);
    await route.abort("blockedbyclient");
    blocked.add(request);
  });
  await context.routeWebSocket(/.*/, async (socket) => {
    sockets.push(socket.url());
    // Never call connectToServer: even the handshake must stay off the network.
    await socket.close({ code: 1008, reason: "Privacy regression control" });
    blockedSockets.push(socket.url());
  });
  return {
    requests,
    forbidden,
    blocked,
    sockets,
    blockedSockets,
    violations: () => [
      ...Array.from(forbidden, (request) => `${request.method()} ${request.url()}`),
      ...sockets.map((url) => `WebSocket ${url}`),
    ],
  };
}

export const test = base.extend<{ privacy: Awaited<ReturnType<typeof observePrivacy>> }>({
  privacy: [
    async ({ context, baseURL }, use) => {
      if (!baseURL) throw new Error("Privacy tests require the preview baseURL");
      const privacy = await observePrivacy(context, baseURL);
      try {
        await use(privacy);
      } finally {
        const cookies = await context.cookies();
        // Retain observation through page unload, including any teardown beacons.
        await context.close();
        expect(privacy.violations(), "Forbidden browser network attempts").toEqual([]);
        expect(cookies, "The editor must not set cookies").toEqual([]);
      }
    },
    { auto: true },
  ],
});

test.use({ serviceWorkers: "block" });
