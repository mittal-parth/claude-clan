import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstructionTracker } from "./construction-tracker";

const GRACE = 6_000;

function tracker() {
  const seen: string[][] = [];
  const instance = new ConstructionTracker({
    graceMs: GRACE,
    onChange: (paths) => seen.push(paths),
  });
  return { instance, seen, latest: () => seen[seen.length - 1] ?? [] };
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

    instance.start("src/App.tsx", "tool-1");

    expect(latest()).toEqual(["src/App.tsx"]);
  });

  it("holds the site for as long as the tool runs, however long that is", () => {
    const { instance, latest } = tracker();
    instance.start("src/App.tsx", "tool-1");

    // Far longer than the grace period; a held site must not time out.
    vi.advanceTimersByTime(GRACE * 10);
    expect(latest()).toEqual(["src/App.tsx"]);

    instance.finish("tool-1");
    expect(latest()).toEqual(["src/App.tsx"]);

    vi.advanceTimersByTime(GRACE - 1);
    expect(latest()).toEqual(["src/App.tsx"]);

    vi.advanceTimersByTime(1);
    expect(latest()).toEqual([]);
  });

  it("keeps an instant write visible for the whole grace period", () => {
    const { instance, latest } = tracker();

    instance.start("README.md", "tool-1");
    instance.finish("tool-1");

    vi.advanceTimersByTime(GRACE - 1);
    expect(latest()).toEqual(["README.md"]);
    vi.advanceTimersByTime(1);
    expect(latest()).toEqual([]);
  });

  it("winds down a change that has no tool behind it", () => {
    const { instance, latest } = tracker();

    instance.start("src/App.tsx");
    expect(latest()).toEqual(["src/App.tsx"]);

    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual([]);
  });

  it("does not close while another tool is still on the same file", () => {
    const { instance, latest } = tracker();
    instance.start("src/App.tsx", "tool-1");
    instance.start("src/App.tsx", "tool-2");

    instance.finish("tool-1");
    vi.advanceTimersByTime(GRACE * 2);
    expect(latest()).toEqual(["src/App.tsx"]);

    instance.finish("tool-2");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual([]);
  });

  it("keeps a site open when a bare change lands mid-tool", () => {
    const { instance, latest } = tracker();
    instance.start("src/App.tsx", "tool-1");

    // file.changed arrives while the edit is still running.
    instance.start("src/App.tsx");

    vi.advanceTimersByTime(GRACE * 3);
    expect(latest()).toEqual(["src/App.tsx"]);

    instance.finish("tool-1");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual([]);
  });

  it("restarts the grace period when work resumes on a closing site", () => {
    const { instance, latest } = tracker();
    instance.start("src/App.tsx", "tool-1");
    instance.finish("tool-1");

    vi.advanceTimersByTime(GRACE - 500);
    instance.start("src/App.tsx", "tool-2");
    vi.advanceTimersByTime(GRACE - 500);
    expect(latest()).toEqual(["src/App.tsx"]);

    instance.finish("tool-2");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual([]);
  });

  it("tracks several files at once and closes them independently", () => {
    const { instance, latest } = tracker();
    instance.start("a.ts", "tool-1");
    instance.start("b.ts", "tool-2");

    expect(latest()).toEqual(["a.ts", "b.ts"]);

    instance.finish("tool-1");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual(["b.ts"]);

    instance.finish("tool-2");
    vi.advanceTimersByTime(GRACE);
    expect(latest()).toEqual([]);
  });

  it("ignores a completion for a tool it never saw", () => {
    const { instance, latest } = tracker();
    instance.start("a.ts", "tool-1");

    expect(() => instance.finish("unknown")).not.toThrow();
    vi.advanceTimersByTime(GRACE * 2);
    expect(latest()).toEqual(["a.ts"]);
  });

  it("does not leak a hold when the same id is reused for another file", () => {
    const { instance, latest } = tracker();
    instance.start("a.ts", "tool-1");
    instance.start("b.ts", "tool-1");

    instance.finish("tool-1");
    vi.advanceTimersByTime(GRACE);

    // "a.ts" lost its hold when the id moved, so both wind down.
    expect(latest()).toEqual([]);
  });

  it("stops firing once disposed", () => {
    const { instance, seen } = tracker();
    instance.start("a.ts");
    const count = seen.length;

    instance.dispose();
    vi.advanceTimersByTime(GRACE * 2);

    expect(seen.length).toBe(count);
  });
});
