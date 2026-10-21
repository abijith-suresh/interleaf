import { createServer } from "node:http";
import { expect, type Request, test } from "@playwright/test";
import { finishPrivacy, observePrivacy } from "./fixtures/privacy";

// These deliberate violations never run in the app workflow contexts. All payloads are synthetic.
test.use({ serviceWorkers: "block" });

for (const control of [
  { name: "same-origin POST", method: "POST", path: "/app" },
  { name: "same-origin PUT", method: "PUT", path: "/app" },
  { name: "same-origin PATCH", method: "PATCH", path: "/app" },
  { name: "same-origin DELETE", method: "DELETE", path: "/app" },
  { name: "bodyless same-origin POST", method: "POST", path: "/app", bodyless: true },
  { name: "bodyless same-origin PUT", method: "PUT", path: "/app", bodyless: true },
  { name: "bodyless same-origin PATCH", method: "PATCH", path: "/app", bodyless: true },
  { name: "bodyless same-origin DELETE", method: "DELETE", path: "/app", bodyless: true },
  { name: "same-origin unknown GET", method: "GET", path: "/synthetic-upload" },
  {
    name: "same-origin static query payload",
    method: "GET",
    path: "/qpdf/qpdf-worker.js?file=synthetic",
  },
  {
    name: "cross-origin fetch of an otherwise allowed asset path",
    method: "GET",
    path: "https://privacy.invalid/qpdf/qpdf-worker.js",
  },
  { name: "same-origin file upload", method: "POST", path: "/app", upload: true },
]) {
  test(`guard detects and aborts ${control.name}`, async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("Missing preview baseURL");
    const guard = await observePrivacy(context, baseURL);
    await page.goto("/app");
    const url = new URL(control.path, baseURL).href;
    const failures: Request[] = [];
    context.on("requestfailed", (request) => failures.push(request));
    const outcome = await page.evaluate(
      async ({ url, method, upload, bodyless }) => {
        const body = new FormData();
        body.append("file", new Blob(["synthetic-privacy-control"]), "synthetic.pdf");
        try {
          await fetch(url, {
            method,
            mode: "cors",
            body:
              method === "GET" || bodyless
                ? undefined
                : upload
                  ? body
                  : "synthetic-privacy-control",
          });
          return "resolved";
        } catch {
          return "rejected";
        }
      },
      { url, method: control.method, upload: "upload" in control, bodyless: "bodyless" in control }
    );
    expect(outcome).toBe("rejected");
    await expect.poll(() => failures.some((request) => request.url() === url)).toBe(true);
    const request = failures.find((request) => request.url() === url);
    if (!request) throw new Error("Missing aborted control request");
    await expect.poll(() => guard.blocked.has(request)).toBe(true);
    expect(guard.forbidden.has(request)).toBe(true);
    expect(guard.violations()).toEqual([`${control.method} ${url}`]);
    if ("upload" in control) expect(request.postData()).toContain("synthetic.pdf");
    if ("bodyless" in control) expect(request.postDataBuffer()).toBeNull();
  });
}

test("finalizer rejects a synthetic lifecycle beacon before closing the context", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing preview baseURL");
  const guard = await observePrivacy(context, baseURL);
  const events: string[] = [];
  const failures: Request[] = [];
  page.on("console", (message) => {
    if (message.text() === "synthetic-beforeunload") events.push(message.text());
  });
  context.on("requestfailed", (request) => failures.push(request));
  await page.goto("/app");
  await page.evaluate(() => {
    window.addEventListener("beforeunload", () => {
      // biome-ignore lint/suspicious/noConsole: Observe the actual browser lifecycle event in this control.
      console.log("synthetic-beforeunload");
      navigator.sendBeacon("/app", "synthetic-lifecycle-beacon");
    });
  });
  await expect(finishPrivacy(context, guard, baseURL)).rejects.toThrow(
    "Forbidden browser network attempts, including teardown"
  );
  expect(events).toEqual(["synthetic-beforeunload"]);
  const request = [...guard.forbidden].find(
    (request) => request.postData() === "synthetic-lifecycle-beacon"
  );
  if (!request) throw new Error("The real lifecycle event must initiate the beacon");
  expect(guard.blocked.has(request), "The beacon must be aborted before cleanup").toBe(true);
  // Chromium can omit requestfailed after document unload. The awaited abort above is the proof;
  // terminal-event delivery is diagnostic and is not controlled by the application.
  await test.info().attach("lifecycle-observation", {
    contentType: "application/json",
    body: JSON.stringify({
      browser: test.info().project.name,
      events,
      beaconBody: request.postData(),
      blockedSameRequest: guard.blocked.has(request),
      requestFailedCount: failures.filter((failed) => failed === request).length,
    }),
  });
  expect(guard.violations()).toEqual([`POST ${new URL("/app", baseURL).href}`]);
});

test("coverage limit: dedicated-worker WebSockets reach an owned loopback listener unseen by the guard", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing preview baseURL");
  let handshakes = 0;
  const server = createServer();
  server.on("upgrade", (_request, socket) => {
    handshakes++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing loopback address");
    const url = `ws://127.0.0.1:${address.port}/synthetic-worker-socket`;
    const guard = await observePrivacy(context, baseURL);
    await page.goto("/app");
    await page.evaluate(async (url) => {
      const script = URL.createObjectURL(
        new Blob(
          [
            `const socket = new WebSocket(${JSON.stringify(url)});
         socket.onclose = () => postMessage("closed");`,
          ],
          { type: "text/javascript" }
        )
      );
      const worker = new Worker(script);
      try {
        await new Promise((resolve) => {
          worker.onmessage = resolve;
        });
      } finally {
        worker.terminate();
        URL.revokeObjectURL(script);
      }
    }, url);
    // This is a capability characterization, not privacy protection. No PDF or message is sent.
    expect(handshakes).toBe(1);
    expect(guard.sockets).toEqual([]);
    expect(guard.violations()).toEqual([]);
    await test.info().attach("worker-websocket-observation-limit", {
      contentType: "application/json",
      body: JSON.stringify({
        browser: test.info().project.name,
        handshakes,
        guardSockets: guard.sockets,
        violations: guard.violations(),
      }),
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

for (const path of ["/app", "https://privacy.invalid/beacon"]) {
  test(`guard detects and aborts a beacon to ${path}`, async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("Missing preview baseURL");
    const guard = await observePrivacy(context, baseURL);
    await page.goto("/app");
    const url = new URL(path, baseURL).href;
    const failed = context.waitForEvent("requestfailed", (request) => request.url() === url);
    expect(await page.evaluate((url) => navigator.sendBeacon(url, "synthetic-control"), url)).toBe(
      true
    );
    const request = await failed;
    await expect.poll(() => guard.blocked.has(request)).toBe(true);
    expect(guard.violations()).toEqual([`POST ${url}`]);
  });
}

test("guard detects and aborts a cross-origin subframe resource", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing preview baseURL");
  const guard = await observePrivacy(context, baseURL);
  const url = "https://privacy.invalid/og/app.png";
  const failed = context.waitForEvent("requestfailed", (request) => request.url() === url);
  // Trigger on the initial document load to prove the guard is installed early enough.
  await context.addInitScript((url) => {
    if (window !== window.top) return;
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        const iframe = document.createElement("iframe");
        iframe.srcdoc = `<img src="${url}">`;
        document.body.append(iframe);
      },
      { once: true }
    );
  }, url);
  await page.goto("/app");
  const request = await failed;
  await expect.poll(() => guard.blocked.has(request)).toBe(true);
  expect(request.resourceType()).toBe("image");
  expect(request.frame().parentFrame()).not.toBeNull();
  expect(guard.violations()).toEqual([`GET ${url}`]);
});

for (const path of ["/synthetic-socket", "ws://privacy.invalid/socket"]) {
  test(`guard detects and closes WebSocket ${path} without connecting`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Missing preview baseURL");
    const guard = await observePrivacy(context, baseURL);
    await page.goto("/app");
    const url = new URL(path, baseURL);
    url.protocol = "ws:";
    const code = await page.evaluate(
      (url) =>
        new Promise<number>((resolve) => {
          const socket = new WebSocket(url);
          socket.onclose = (event) => resolve(event.code);
        }),
      url.href
    );
    expect(code).toBe(1008);
    await expect.poll(() => guard.blockedSockets).toEqual([url.href]);
    expect(guard.violations()).toEqual([`WebSocket ${url.href}`]);
  });
}

for (const control of [
  { path: "/app", method: "POST" },
  { path: "https://privacy.invalid/qpdf/qpdf-worker.js", method: "GET" },
]) {
  test(`guard detects and aborts a dedicated-worker ${control.method} to ${control.path}`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Missing preview baseURL");
    const guard = await observePrivacy(context, baseURL);
    await page.goto("/app");
    const url = new URL(control.path, baseURL).href;
    const failed = context.waitForEvent("requestfailed", (request) => request.url() === url);
    const outcome = await page.evaluate(
      async ({ url, method }) => {
        const script = URL.createObjectURL(
          new Blob(
            [
              `fetch(${JSON.stringify(url)}, {method: ${JSON.stringify(method)},
              body: ${method === "POST" ? '"synthetic-control"' : "undefined"}, mode: "no-cors"})
          .then(() => postMessage("resolved"), () => postMessage("rejected"));`,
            ],
            { type: "text/javascript" }
          )
        );
        const worker = new Worker(script);
        try {
          return await new Promise((resolve) => {
            worker.onmessage = (event) => resolve(event.data);
          });
        } finally {
          worker.terminate();
          URL.revokeObjectURL(script);
        }
      },
      { url, method: control.method }
    );
    const request = await failed;
    expect(outcome).toBe("rejected");
    await expect.poll(() => guard.blocked.has(request)).toBe(true);
    expect(guard.violations()).toEqual([`${control.method} ${url}`]);
  });
}
