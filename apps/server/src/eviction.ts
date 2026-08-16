export interface EvictionCandidate {
  key: string;
  /** Bumped on every access; the oldest is the usual victim. */
  lastUsedAt: number;
}

/**
 * Picks which workspace to evict. Evicting deletes the clone, so a working
 * tree with uncommitted edits is destroyed with it -- a crew's work between
 * sessions lives nowhere else. So age is the tiebreak, not the rule: the
 * oldest *clean* workspace goes first, and a dirty one is only chosen when
 * every candidate is dirty and something has to give.
 *
 * `isDirty` is checked lazily in age order rather than up front, so the common
 * case costs one `git status` rather than one per open workspace.
 */
export async function chooseEvictionVictim<T extends EvictionCandidate>(
  candidates: readonly T[],
  isDirty: (candidate: T) => Promise<boolean>,
): Promise<{ victim: T; dirty: boolean } | undefined> {
  const oldestFirst = [...candidates].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const oldest = oldestFirst[0];
  if (!oldest) {
    return undefined;
  }
  for (const candidate of oldestFirst) {
    if (!(await isDirty(candidate))) {
      return { victim: candidate, dirty: false };
    }
  }
  return { victim: oldest, dirty: true };
}
