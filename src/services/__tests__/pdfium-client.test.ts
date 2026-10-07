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
  it("creates one lazy worker, matches responses by sequence, and transfers bytes", async () => {
    const { worker, client, create, respond } = fakeWorker();
    expect(create).not.toHaveBeenCalled();
    const bytes = new Uint8Array([1]);
    const open = client.request("open", { bytes }, [bytes.buffer]);
    const info = client.request("info", { id: 1, page: 1, rotation: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(worker.postMessage.mock.calls[0][1]).toEqual([bytes.buffer]);
    respond({ sequence: 2, ok: true, value: { width: 200, height: 300, rotation: 0 } });
    respond({ sequence: 1, ok: true, value: { id: 1, count: 1 } });
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
