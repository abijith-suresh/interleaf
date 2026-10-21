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

// Install before navigation. Context routing observes HTTP requests from pages, subframes and
// dedicated workers, plus page WebSockets. Worker WebSockets bypass Playwright's routing and are
// NOT observed or blocked here; the loopback capability control documents that gap.
// Fresh contexts block service workers because they can bypass routes. These tests do not audit
// production service workers, browser background traffic, every input, or third-party internals.
export async function observePrivacy(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const assets = new Set(await staticPaths());
  const requests: Request[] = [];
  const forbidden = new Set<Request>();
  const blocked = new Set<Request>();
  const sockets: string[] = [];
  const blockedSockets: string[] = [];
  const pending = new Set<Promise<void>>();
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
    const task = (async () => {
      const request = route.request();
      if (allowed(request)) return route.continue();
      // Keep attempts even when abort prevents any upload or third-party connection.
      forbidden.add(request);
      await route.abort("blockedbyclient");
      blocked.add(request);
    })();
    pending.add(task);
    try {
      await task;
    } finally {
      pending.delete(task);
    }
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
    settle: async () => {
      while (pending.size) await Promise.all(pending);
    },
    violations: () => [
      ...Array.from(forbidden, (request) => `${request.method()} ${request.url()}`),
      ...sockets.map((url) => `WebSocket ${url}`),
    ],
  };
}

export async function finishPrivacy(
  context: BrowserContext,
  privacy: Awaited<ReturnType<typeof observePrivacy>>,
  baseURL: string
) {
  try {
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      // context.close() skips page lifecycle events. A same-origin navigation exercises the
      // original document's beforeunload, and pagehide/unload where the browser dispatches them.
      // about:blank navigation can discard Chromium's keepalive requests before routing sees them.
      await page.goto(new URL("/", baseURL).href, { waitUntil: "load" });
    }
    await privacy.settle();
    const cookies = await context.cookies();
    expect(privacy.violations(), "Forbidden browser network attempts, including teardown").toEqual(
      []
    );
    expect(cookies, "The editor must not set cookies").toEqual([]);
  } finally {
    await context.close();
  }
}

export const test = base.extend<{ privacy: Awaited<ReturnType<typeof observePrivacy>> }>({
  privacy: [
    async ({ context, baseURL }, use) => {
      if (!baseURL) throw new Error("Privacy tests require the preview baseURL");
      const privacy = await observePrivacy(context, baseURL);
      try {
        await use(privacy);
      } finally {
        await finishPrivacy(context, privacy, baseURL);
      }
    },
    { auto: true },
  ],
});

test.use({ serviceWorkers: "block" });
