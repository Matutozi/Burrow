/**
 * "What Burrow has done for you": how many tabs it has put away, kept so the panel can show the
 * benefit. A single small counter in local storage; nothing about the pages themselves.
 */
import type { ArchiveArea } from './store';

export const STATS_KEY = 'stats';

/**
 * Rough memory one open tab uses, for the "memory freed" estimate shown to the user. Real tabs vary
 * from ~20 MB to several hundred; this keeps the estimate on the cautious side. Not a scoring number.
 */
export const ESTIMATED_MB_PER_TAB = 50;

export interface Stats {
  tabsPutAway: number;
  /** Epoch ms of the first tab put away. */
  since: number;
}

export const EMPTY_STATS: Stats = Object.freeze({ tabsPutAway: 0, since: 0 });

export function sanitizeStats(v: unknown): Stats {
  if (typeof v !== 'object' || v === null) return EMPTY_STATS;
  const { tabsPutAway, since } = v as Record<string, unknown>;
  const n = typeof tabsPutAway === 'number' && Number.isFinite(tabsPutAway) ? Math.max(0, Math.floor(tabsPutAway)) : 0;
  const s = typeof since === 'number' && Number.isFinite(since) && since > 0 ? since : 0;
  return { tabsPutAway: n, since: n > 0 ? s : 0 };
}

/** Pure: the stats after `delta` tabs were put away (negative when an undo reopened them). */
export function applyDelta(stats: Stats, delta: number, now: number): Stats {
  const tabsPutAway = Math.max(0, stats.tabsPutAway + Math.trunc(delta));
  if (tabsPutAway === 0) return EMPTY_STATS;
  return { tabsPutAway, since: stats.since || now };
}

export function estimatedMbFreed(stats: Stats): number {
  return stats.tabsPutAway * ESTIMATED_MB_PER_TAB;
}

export async function readStats(area: ArchiveArea): Promise<Stats> {
  return sanitizeStats((await area.get([STATS_KEY]))[STATS_KEY]);
}

/** Best effort: a counter that fails to update must never fail an archive. */
export async function recordPutAway(delta: number, area: ArchiveArea, now: number = Date.now()): Promise<void> {
  if (delta === 0) return;
  try {
    await area.set({ [STATS_KEY]: applyDelta(await readStats(area), delta, now) });
  } catch (err) {
    console.warn('Burrow: could not update stats', err);
  }
}
