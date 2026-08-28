import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstructionTracker, type ConstructionSitesBySession } from "./construction-tracker";

const GRACE = 6_000;
const SESSION_A = "session-a";
const SESSION_B = "session-b";

function tracker() {
  const seen: ConstructionSitesBySession[] = [];
  const instance = new ConstructionTracker({
    graceMs: GRACE,
    onChange: (sitesBySession) => seen.push(sitesBySession),
  });
  return {
    instance,
    seen,
    latest: () => seen[seen.length - 1] ?? {},
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("construction tracker", () => {
  it("opens a site the moment work starts", () => {
    const { instance, latest } = tracker();

    instance.start(SESSION_A, "src/App.tsx", "tool-1");

    expect(latest()).toEqual({ [SESSION_A]: ["src/App.tsx"] });
  });

  it("keeps holds isolated between sessions", () => {
    const { instance, latest } = tracker();
    instance.start(SESSION_A, "src/App.tsx", "tool-1");
    instance.start(SESSION_B, "src/App.tsx", "tool-1");

    instance.finish(SESSION_A, "tool-1");
    vi.advanceTimersByTime(GRACE);

    expect(latest()).toEqual({ [SESSION_B]: ["src/App.tsx"] });
  });

  it("holds the site for as long as the tool runs, however long that is", () => {
    const { instance, latest } = tracker();
    instance.start(SESSION_A, "src/App.tsx", "tool-1");

    vi.advanceTimersByTime(GRACE * 10);
    expect(latest()).toEqual({ [SESSION_A]: ["src/App.tsx"] });

    instance.finish(SESSION_A, "tool-1");
    expect(latest()).toEqual({ [SESSION_A]: ["src/App.tsx"] });

    vi.advanceTimersByTime(GRACE - 1);
    expect(latest()).toEqual({ [SESSION_A]: ["src/App.tsx"] });

    vi.advanceTimersByTime(1);
    expect(latest()).toEqual({});
  });

  it("keeps an instant write visible for the whole grace period", () => {
    const { instance, latest } = tracker();

    instance.start(SESSION_A, "README.md", "tool-1");
    instance.finish(SESSION_A, "tool-1");

    vi.advanceTimersByTime(GRACE - 1);
    expect(latest()).toEqual({ [SESSION_A]: ["README.md"] });
    vi.advanceTimersByTime(1);
    expect(latest()).toEqual({});
  });

  it("winds down a change that has no tool behind it", () => {
    const { instance, latest } = tracker();

    instance.start(SESSION_A, "src/App.tsx");
    expect(latest()).toEqual({ [SESSION_A]: ["src/App.tsx"] });

    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual({});
  });

  it("does not close while another tool is still on the same file", () => {
    const { instance, latest } = tracker();
    instance.start(SESSION_A, "src/App.tsx", "tool-1");
    instance.start(SESSION_A, "src/App.tsx", "tool-2");

    instance.finish(SESSION_A, "tool-1");
    vi.advanceTimersByTime(GRACE * 2);
    expect(latest()).toEqual({ [SESSION_A]: ["src/App.tsx"] });

    instance.finish(SESSION_A, "tool-2");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual({});
  });

  it("keeps a site open when a bare change lands mid-tool", () => {
    const { instance, latest } = tracker();
    instance.start(SESSION_A, "src/App.tsx", "tool-1");
    instance.start(SESSION_A, "src/App.tsx");

    vi.advanceTimersByTime(GRACE * 3);
    expect(latest()).toEqual({ [SESSION_A]: ["src/App.tsx"] });

    instance.finish(SESSION_A, "tool-1");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual({});
  });

  it("restarts the grace period when work resumes on a closing site", () => {
    const { instance, latest } = tracker();
    instance.start(SESSION_A, "src/App.tsx", "tool-1");
    instance.finish(SESSION_A, "tool-1");

    vi.advanceTimersByTime(GRACE - 500);
    instance.start(SESSION_A, "src/App.tsx", "tool-2");
    vi.advanceTimersByTime(GRACE - 500);
    expect(latest()).toEqual({ [SESSION_A]: ["src/App.tsx"] });

    instance.finish(SESSION_A, "tool-2");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual({});
  });

  it("tracks several files at once and closes them independently", () => {
    const { instance, latest } = tracker();
    instance.start(SESSION_A, "a.ts", "tool-1");
    instance.start(SESSION_A, "b.ts", "tool-2");

    expect(latest()).toEqual({ [SESSION_A]: ["a.ts", "b.ts"] });

    instance.finish(SESSION_A, "tool-1");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual({ [SESSION_A]: ["b.ts"] });

    instance.finish(SESSION_A, "tool-2");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual({});
  });

  it("ignores a completion for a tool it never saw", () => {
    const { instance, latest } = tracker();
    instance.start(SESSION_A, "a.ts", "tool-1");

    expect(() => instance.finish(SESSION_A, "unknown")).not.toThrow();
    vi.advanceTimersByTime(GRACE * 2);
    expect(latest()).toEqual({ [SESSION_A]: ["a.ts"] });
  });

  it("does not leak a hold when the same id is reused for another file", () => {
    const { instance, latest } = tracker();
    instance.start(SESSION_A, "a.ts", "tool-1");
    instance.start(SESSION_A, "b.ts", "tool-1");

    instance.finish(SESSION_A, "tool-1");
    vi.advanceTimersByTime(GRACE);

    expect(latest()).toEqual({});
  });

  it("stops firing once disposed", () => {
    const { instance, seen } = tracker();
    instance.start(SESSION_A, "a.ts");
    const count = seen.length;

    instance.dispose();
    vi.advanceTimersByTime(GRACE * 2);

    expect(seen.length).toBe(count);
  });
});
