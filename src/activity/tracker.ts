/**
 * Pure activity accounting. Given focus changes, it counts visits and foreground time per tab.
 * No Chrome APIs here, so every edge case is unit-tested.
 */

export interface TabActivity {
  visits: number;
  activeMs: number;
}

export interface ActivityState {
  /** The tab the user is looking at right now, and since when. Null when Chrome is unfocused or the user is idle. */
  current: { tabId: number; since: number } | null;
  /** Keyed by tab id (as a string, because storage stores object keys as strings). */
  tabs: Record<string, TabActivity>;
}

export const EMPTY_ACTIVITY: ActivityState = Object.freeze({ current: null, tabs: Object.freeze({}) }) as ActivityState;

/**
 * Safety cap for one uninterrupted stretch on a tab. Idle and lock events normally end a stretch,
 * but if one is missed (for example the machine slept), this stops the time from inflating.
 */
export const MAX_SEGMENT_MS = 4 * 60 * 60 * 1000;

const ZERO: TabActivity = { visits: 0, activeMs: 0 };

/** Adds the time since `current.since` to the current tab. */
function commit(state: ActivityState, now: number): ActivityState {
  const cur = state.current;
  if (!cur) return state;
  const elapsed = Math.min(MAX_SEGMENT_MS, Math.max(0, now - cur.since));
  const key = String(cur.tabId);
  const prev = state.tabs[key] ?? ZERO;
  return { current: cur, tabs: { ...state.tabs, [key]: { visits: prev.visits, activeMs: prev.activeMs + elapsed } } };
}

/** The user is now looking at `tabId`, or at nothing (null). */
export function focusTab(state: ActivityState, tabId: number | null, now: number): ActivityState {
  const committed = commit(state, now);
  if (tabId === null) return { current: null, tabs: committed.tabs };
  if (committed.current?.tabId === tabId) return { current: { tabId, since: now }, tabs: committed.tabs };
  const key = String(tabId);
  const prev = committed.tabs[key] ?? ZERO;
  return {
    current: { tabId, since: now },
    tabs: { ...committed.tabs, [key]: { visits: prev.visits + 1, activeMs: prev.activeMs } },
  };
}

/** A tab was closed: forget it. */
export function removeTab(state: ActivityState, tabId: number, now: number): ActivityState {
  const committed = commit(state, now);
  const { [String(tabId)]: _removed, ...rest } = committed.tabs;
  const current = committed.current?.tabId === tabId ? null : committed.current;
  return { current, tabs: rest };
}

/** Chrome swapped one tab for another (prerendering, discarding). Move its history to the new id. */
export function replaceTab(state: ActivityState, addedId: number, removedId: number): ActivityState {
  const oldKey = String(removedId);
  const moved = state.tabs[oldKey];
  if (!moved && state.current?.tabId !== removedId) return state;
  const { [oldKey]: _old, ...rest } = state.tabs;
  return {
    current: state.current?.tabId === removedId ? { tabId: addedId, since: state.current.since } : state.current,
    tabs: moved ? { ...rest, [String(addedId)]: moved } : rest,
  };
}

/** Drops tabs that no longer exist, so stale ids can't build up. */
export function pruneTabs(state: ActivityState, openTabIds: Iterable<number>): ActivityState {
  const open = new Set([...openTabIds].map(String));
  const tabs: Record<string, TabActivity> = {};
  for (const [k, v] of Object.entries(state.tabs)) if (open.has(k)) tabs[k] = v;
  const current = state.current && open.has(String(state.current.tabId)) ? state.current : null;
  return { current, tabs };
}

/** Activity for one tab, including the in-progress stretch if it's the current tab. */
export function activityFor(state: ActivityState, tabId: number, now: number): TabActivity {
  const base = state.tabs[String(tabId)] ?? ZERO;
  if (state.current?.tabId !== tabId) return base;
  const live = Math.min(MAX_SEGMENT_MS, Math.max(0, now - state.current.since));
  return { visits: base.visits, activeMs: base.activeMs + live };
}

function nonNegative(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Never trust storage: turns anything into a valid ActivityState. */
export function sanitizeActivity(raw: unknown): ActivityState {
  if (typeof raw !== 'object' || raw === null) return EMPTY_ACTIVITY;
  const r = raw as { current?: unknown; tabs?: unknown };
  const tabs: Record<string, TabActivity> = {};
  if (typeof r.tabs === 'object' && r.tabs !== null) {
    for (const [k, v] of Object.entries(r.tabs as Record<string, unknown>)) {
      if (!/^\d+$/.test(k) || typeof v !== 'object' || v === null) continue;
      const a = v as { visits?: unknown; activeMs?: unknown };
      tabs[k] = { visits: Math.floor(nonNegative(a.visits)), activeMs: nonNegative(a.activeMs) };
    }
  }
  let current: ActivityState['current'] = null;
  if (typeof r.current === 'object' && r.current !== null) {
    const c = r.current as { tabId?: unknown; since?: unknown };
    if (typeof c.tabId === 'number' && Number.isInteger(c.tabId) && nonNegative(c.since) > 0) {
      current = { tabId: c.tabId, since: c.since as number };
    }
  }
  return { current, tabs };
}
