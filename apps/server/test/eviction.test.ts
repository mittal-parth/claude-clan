import { describe, expect, it, vi } from "vitest";
import { chooseEvictionVictim } from "../src/eviction.js";

const dirtySet = (...keys: string[]) => {
  const dirty = new Set(keys);
  return vi.fn(async (candidate: { key: string }) => dirty.has(candidate.key));
};

describe("chooseEvictionVictim", () => {
  it("takes the oldest when nothing has uncommitted work", async () => {
    const chosen = await chooseEvictionVictim(
      [
        { key: "b", lastUsedAt: 200 },
        { key: "a", lastUsedAt: 100 },
        { key: "c", lastUsedAt: 300 },
      ],
      dirtySet(),
    );

    expect(chosen).toMatchObject({ victim: { key: "a" }, dirty: false });
  });

  it("skips a dirty workspace in favour of a newer clean one", async () => {
    const chosen = await chooseEvictionVictim(
      [
        { key: "dirty-oldest", lastUsedAt: 100 },
        { key: "clean-newer", lastUsedAt: 200 },
      ],
      dirtySet("dirty-oldest"),
    );

    expect(chosen).toMatchObject({ victim: { key: "clean-newer" }, dirty: false });
  });

  it("falls back to the oldest when every candidate is dirty, and says so", async () => {
    const chosen = await chooseEvictionVictim(
      [
        { key: "newer", lastUsedAt: 200 },
        { key: "oldest", lastUsedAt: 100 },
      ],
      dirtySet("newer", "oldest"),
    );

    // The cap still has to be honoured, but the caller needs to know work is
    // being destroyed so it can log it.
    expect(chosen).toMatchObject({ victim: { key: "oldest" }, dirty: true });
  });

  it("stops checking once it finds a clean candidate", async () => {
    const isDirty = dirtySet("a");
    await chooseEvictionVictim(
      [
        { key: "a", lastUsedAt: 100 },
        { key: "b", lastUsedAt: 200 },
        { key: "c", lastUsedAt: 300 },
      ],
      isDirty,
    );

    // `git status` per candidate is the cost being avoided: a is dirty, b is
    // clean, so c must never be inspected.
    expect(isDirty).toHaveBeenCalledTimes(2);
  });

  it("returns nothing when there is no candidate", async () => {
    expect(await chooseEvictionVictim([], dirtySet())).toBeUndefined();
  });

  it("does not reorder the caller's array", async () => {
    const candidates = [
      { key: "b", lastUsedAt: 200 },
      { key: "a", lastUsedAt: 100 },
    ];

    await chooseEvictionVictim(candidates, dirtySet());

    expect(candidates.map((c) => c.key)).toEqual(["b", "a"]);
  });
});
