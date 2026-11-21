/**
 * Decides which open tabs to archive. Pure (Chrome tab objects in, plain data out), shared by the
 * side panel and the automatic archiver so both follow exactly the same safety rules.
 */
import { activityFor, type ActivityState } from '../activity/tracker';
import type { Preferences } from '../prefs/types';
import type { Scorer, TabSignals } from '../scoring/score';
import type { GroupMap } from '../groups/info';
import { archiveBlocker } from './record';
import type { ArchiveRequest } from './store';

const HOUR_MS = 60 * 60 * 1000;

/** Where a tab was, so undo can put it back in the same window and position. */
export interface TabPlace {
  windowId: number;
  index: number;
}

/** Keyed by URL. A plain object (not a Map) so it can be stored for undo. */
export type TabPlaces = Record<string, TabPlace>;

export interface ArchivePlan {
  requests: ArchiveRequest[];
  places: TabPlaces;
  /** Tabs whose text may be read: policy is "full" and the page is loaded. */
  readable: number[];
}

export function signalsOf(tab: chrome.tabs.Tab, activity: ActivityState, now: number, groups?: GroupMap): TabSignals {
  const used = tab.id === undefined ? undefined : activityFor(activity, tab.id, now);
  return {
    groupTitle: groups?.get(tab.groupId)?.title,
    url: tab.url ?? '',
    title: tab.title ?? '',
    lastAccessed: tab.lastAccessed ?? now,
    pinned: tab.pinned,
    audible: tab.audible ?? false,
    active: tab.active,
    visitCount: used?.visits,
    activeMs: used?.activeMs,
  };
}

export interface PlanOptions {
  scorer: Scorer;
  prefs: Preferences;
  activity: ActivityState;
  now: number;
  /** Open tab groups, when tab group support is on. */
  groups?: GroupMap;
  /**
   * The user picked these tabs in a preview, so the score threshold doesn't apply. Protection
   * still does: an active, pinned or audible tab is never closed.
   */
  chosen?: boolean;
  /** "Save under" name for every archived tab. */
  label?: string;
  /** Per-tab "Save under" names, which win over `label`. */
  labels?: ReadonlyMap<number, string>;
  /**
   * Automatic mode adds extra guards: a minimum untouched time, a per-run cap, no pages that
   * can't be archived, and never closing the last tab of a window.
   */
  auto?: boolean;
}

/**
 * Plans archiving for `tabs`. Every tab is re-scored here, so a tab that became active, pinned or
 * audible since the list was drawn is left alone. In automatic mode, `allTabs` must be every open
 * tab, so windows can be counted.
 */
export function planArchive(tabs: chrome.tabs.Tab[], opts: PlanOptions, allTabs: chrome.tabs.Tab[] = tabs): ArchivePlan {
  const { scorer, prefs, activity, now, groups, label, labels, chosen = false, auto = false } = opts;
  const minAgeMs = prefs.autoArchiveAfterHours * HOUR_MS;

  let picked = tabs.flatMap((tab) => {
    if (tab.id === undefined || tab.incognito) return [];
    const result = scorer.score(signalsOf(tab, activity, now, groups), now);
    if (chosen ? result.protected : !scorer.isArchiveCandidate(result)) return [];
    const url = tab.url ?? '';
    const policy = result.indexPolicy;
    if (auto) {
      if (archiveBlocker(url, policy) !== null) return [];
      if (tab.lastAccessed === undefined || now - tab.lastAccessed < minAgeMs) return [];
    }
    return [{ tab, id: tab.id, url, policy, result }];
  });

  if (auto) {
    // Lowest score first, then oldest, up to the per-run cap.
    picked.sort((a, b) => a.result.score - b.result.score || (a.tab.lastAccessed ?? 0) - (b.tab.lastAccessed ?? 0));
    // Closing a window's last tab closes the window, which nobody expects from a background cleanup.
    const left = new Map<number, number>();
    for (const t of allTabs) if (!t.incognito) left.set(t.windowId, (left.get(t.windowId) ?? 0) + 1);
    picked = picked.filter((p) => {
      const n = left.get(p.tab.windowId) ?? 0;
      if (n <= 1) return false;
      left.set(p.tab.windowId, n - 1);
      return true;
    });
    picked = picked.slice(0, prefs.autoArchiveMaxPerRun);
  }

  const places: TabPlaces = {};
  const readable: number[] = [];
  const requests = picked.map(({ tab, id, url, policy, result }) => {
    places[url] = { windowId: tab.windowId, index: tab.index };
    // Sleeping (discarded) tabs have no page loaded, so there is nothing to read from them.
    if (policy === 'full' && !tab.discarded && archiveBlocker(url, 'full') === null) readable.push(id);
    const input = {
      url,
      title: tab.title ?? '',
      contentType: result.contentType,
      score: result.score,
      category: result.category?.name,
      group: groups?.get(tab.groupId),
      label: labels?.get(id) ?? label,
    };
    return { tabId: id, input, policy };
  });
  return { requests, places, readable };
}
