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

  it("lets router navigation proceed without work or after the user confirms", () => {
    let work = false;
    const confirm = vi.fn(() => true);
    release = guardLeave(() => work, confirm);
    const idle = preparation();
    expect(confirm).not.toHaveBeenCalled();
    expect(idle.event.loader).toBe(idle.loader);
    work = true;
    const confirmed = preparation();
    expect(confirm).toHaveBeenCalledWith(LEAVE_EDITOR_MESSAGE);
    expect(confirmed.event.loader).toBe(confirmed.loader);
    expect(confirmed.event.defaultPrevented).toBe(false);
  });

  it("holds a declined navigation without a full page load until the router supersedes it", async () => {
    release = guardLeave(
      () => true,
      () => false
    );
    const declined = preparation();
    // preventDefault() would make the router load the page in full instead.
    expect(declined.event.defaultPrevented).toBe(false);
    expect(declined.event.loader).not.toBe(declined.loader);
    let settled = false;
    const loading = declined.event.loader().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(declined.loader).not.toHaveBeenCalled();
    declined.controller.abort();
    await loading;
    expect(declined.event.defaultPrevented).toBe(true);
  });

  it("returns a declined Back to the editor entry and holds that return", () => {
    const go = vi.spyOn(history, "go").mockImplementation(() => {});
    const confirm = vi.fn(() => false);
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
    const forward = preparation({ navigationType: "traverse", direction: "forward" });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(go).toHaveBeenLastCalledWith(-1);
    expect(forward.event.loader).not.toBe(forward.loader);
  });
});
