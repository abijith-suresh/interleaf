import { describe, expect, it, vi } from "vitest";
import { PDFiumClient, PDFiumClientError } from "../pdfium/client";
import type { PDFiumResponse } from "../pdfium/protocol";

function fakeWorker() {
  const worker = {
    onmessage: null as ((event: MessageEvent<PDFiumResponse>) => void) | null,
    onerror: null as (() => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  const create = vi.fn(() => worker as unknown as Worker);
  const client = new PDFiumClient(create);
  const respond = (data: PDFiumResponse) =>
    worker.onmessage?.({ data } as MessageEvent<PDFiumResponse>);
  return { worker, create, client, respond };
}

describe("PDFium worker transport", () => {
  it("creates one lazy worker, serializes commands, matches responses, and transfers bytes", async () => {
    const { worker, client, create, respond } = fakeWorker();
    expect(create).not.toHaveBeenCalled();
    const bytes = new Uint8Array([1]);
    const open = client.request("open", { bytes }, [bytes.buffer]);
    const info = client.request("info", { id: 1, page: 1, rotation: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(worker.postMessage.mock.calls[0][1]).toEqual([bytes.buffer]);
    respond({ sequence: 99, ok: true, value: { id: 9, count: 9 } });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    respond({ sequence: 1, ok: true, value: { id: 1, count: 1 } });
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    respond({ sequence: 2, ok: true, value: { width: 200, height: 300, rotation: 0 } });
    await expect(open).resolves.toEqual({ id: 1, count: 1 });
    await expect(info).resolves.toMatchObject({ width: 200 });
    client.dispose();
  });

  it("returns typed password errors and leaves the worker available for retry", async () => {
    const { client, respond } = fakeWorker();
    const open = client.request("open", { bytes: new Uint8Array([1]) });
    respond({ sequence: 1, ok: false, message: "password", password: true });
    await expect(open).rejects.toEqual(new PDFiumClientError("password", true));
    const retry = client.request("open", { bytes: new Uint8Array([1]), password: "secret" });
    respond({ sequence: 2, ok: true, value: { id: 1, count: 1 } });
    await expect(retry).resolves.toMatchObject({ count: 1 });
    client.dispose();
  });

  it("rejects all pending work on worker failure and does not silently restart edited documents", async () => {
    const { client, worker } = fakeWorker();
    const open = client.request("open", { bytes: new Uint8Array([1]) });
    const info = client.request("info", { id: 1, page: 1, rotation: 0 });
    worker.onerror?.();
    await expect(open).rejects.toThrow("processing stopped");
    await expect(info).rejects.toThrow("processing stopped");
    await expect(client.request("close", { id: 1 })).rejects.toThrow("processing stopped");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects pending operations on disposal", async () => {
    const { client } = fakeWorker();
    const pending = client.request("close", { id: 1 });
    client.dispose();
    await expect(pending).rejects.toThrow("disposed");
  });
});

describe("PDFium scheduling", () => {
  const render = { id: 1, page: 1, rotation: 0, scale: 0.25 };

  it("warms the worker without sending a document or repeating initialization", () => {
    const { client, create, worker } = fakeWorker();
    client.preload();
    client.preload();
    expect(create).toHaveBeenCalledOnce();
    expect(worker.postMessage).not.toHaveBeenCalled();
    client.dispose();
  });

  it("skips cancelled queued renders before native work or pixel allocation", async () => {
    const { client, worker, respond } = fakeWorker();
    const active = client.request("render", render);
    const controller = new AbortController();
    const obsolete = client.request("render", { ...render, page: 2 }, [], {
      signal: controller.signal,
    });
    const rejected = expect(obsolete).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    respond({ sequence: 1, ok: true, value: {} });
    await active;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    client.dispose();
  });

  it("puts inspection before queued thumbnails while preserving mutation order", async () => {
    const { client, worker, respond } = fakeWorker();
    const requests = [
      client.request("render", render),
      client.request("render", render),
      client.request("content", { id: 1, page: 1 }),
      client.request("edit", { id: 1, page: 1, edit: { kind: "form", index: 0, value: "New" } }),
      client.request("content", { id: 1, page: 1 }),
    ];
    expect(worker.postMessage.mock.calls.map(([request]) => request.sequence)).toEqual([1]);
    for (const sequence of [1, 3, 2, 4, 5]) respond({ sequence, ok: true, value: undefined });
    await Promise.all(requests);
    expect(worker.postMessage.mock.calls.map(([request]) => request.sequence)).toEqual([
      1, 3, 2, 4, 5,
    ]);
    client.dispose();
  });

  it("waits for an executing cancelled render before sending the next native command", async () => {
    const { client, worker, respond } = fakeWorker();
    const controller = new AbortController();
    const active = client.request("render", render, [], { signal: controller.signal });
    const next = client.request("close", { id: 1 });
    const rejected = expect(active).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    respond({ sequence: 1, ok: true, value: {} });
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    respond({ sequence: 2, ok: true, value: undefined });
    await next;
    client.dispose();
  });
});
