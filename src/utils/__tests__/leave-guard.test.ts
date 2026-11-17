import { afterEach, describe, expect, it, vi } from "vitest";
import { guardLeave, LEAVE_EDITOR_MESSAGE } from "../leave-guard";

type Preparation = Event & {
  from: URL;
  to: URL;
  direction: string;
  navigationType: string;
  signal: AbortSignal;
  loader: () => Promise<void>;
};

function preparation(options: { to?: string; navigationType?: string; direction?: string } = {}): {
  event: Preparation;
  controller: AbortController;
  loader: () => Promise<void>;
} {
  const controller = new AbortController();
  const loader = vi.fn(async () => {});
  const event = Object.assign(new Event("astro:before-preparation", { cancelable: true }), {
    from: new URL(location.href),
    to: new URL(options.to ?? "/", location.href),
    direction: options.direction ?? "forward",
    navigationType: options.navigationType ?? "push",
    signal: controller.signal,
    loader,
  });
  document.dispatchEvent(event);
  return { event, controller, loader };
}

function unload() {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

describe("guardLeave", () => {
  let release: (() => void) | undefined;
  afterEach(() => {
    release?.();
    release = undefined;
    vi.restoreAllMocks();
  });

  it("asks before unload only while there is work to lose", () => {
    let work = false;
    release = guardLeave(() => work);
    expect(unload().defaultPrevented).toBe(false);
    work = true;
    expect(unload().defaultPrevented).toBe(true);
    release();
    expect(unload().defaultPrevented).toBe(false);
  });

  it("lets router navigation proceed while there is no work to lose", () => {
    const confirm = vi.fn(async () => true);
    release = guardLeave(() => false, confirm);
    const idle = preparation();
    expect(confirm).not.toHaveBeenCalled();
    expect(idle.event.loader).toBe(idle.loader);
  });

  it("holds the navigation while it asks, then loads the page once confirmed", async () => {
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      assign,
      href: "http://localhost:3000/",
    } as unknown as Location);
    let answer!: (leave: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    release = guardLeave(() => true, confirm);
    const asked = preparation({ to: "/elsewhere" });
    expect(confirm).toHaveBeenCalledOnce();
    // preventDefault() would make the router load the page in full instead.
    expect(asked.event.defaultPrevented).toBe(false);
    expect(asked.event.loader).not.toBe(asked.loader);
    expect(assign).not.toHaveBeenCalled();
    answer(true);
    await Promise.resolve();
    expect(assign).toHaveBeenCalledWith("http://localhost:3000/elsewhere");
    // The page is leaving, so neither the router nor the unload prompt asks again.
    expect(unload().defaultPrevented).toBe(false);
  });

  it("keeps a declined navigation pending until the router supersedes it", async () => {
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      assign,
      href: "http://localhost:3000/",
    } as unknown as Location);
    release = guardLeave(
      () => true,
      async () => false
    );
    const declined = preparation();
    await Promise.resolve();
    let settled = false;
    const loading = declined.event.loader().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(declined.loader).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    declined.controller.abort();
    await loading;
    expect(declined.event.defaultPrevented).toBe(true);
  });

  it("returns Back to the editor entry, and repeats it once confirmed", async () => {
    const go = vi.spyOn(history, "go").mockImplementation(() => {});
    let answer!: (leave: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    release = guardLeave(() => true, confirm);
    const back = preparation({ navigationType: "traverse", direction: "back" });
    expect(go).toHaveBeenCalledWith(1);
    expect(back.event.loader).not.toBe(back.loader);
    const restore = preparation({
      to: location.href,
      navigationType: "traverse",
      direction: "forward",
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(restore.event.loader).not.toBe(restore.loader);
    answer(true);
    await Promise.resolve();
    expect(go).toHaveBeenLastCalledWith(-1);
    const proceed = preparation({ navigationType: "traverse", direction: "back" });
    expect(proceed.event.loader).toBe(proceed.loader);
  });
});
