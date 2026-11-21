/**
 * Thin Chrome wrappers shared by the side panel and the service worker. Logic stays in the pure
 * modules next to this file.
 */
import { readActivity } from '../activity/store';
import { EMPTY_ACTIVITY } from '../activity/tracker';
import { readGroups, restoreTabGroup } from '../groups/chromeGroups';
import { mayUse } from '../license/store';
import type { Preferences } from '../prefs/types';
import { CAPTURE_LIMITS, CAPTURE_PERMISSIONS, captureTexts, extractPageText } from './capture';
import { createScorer } from '../scoring/score';
import { planArchive, type ArchivePlan, type TabPlace, type TabPlaces } from './plan';
import { recordPutAway } from './stats';
import type { ArchiveRecord } from './record';
import { archiveTabs, listArchive, reconcileUndo, undoArchive, type ArchiveResult, type ArchiveUndo } from './store';

/** Closes tabs. Returns the ids Chrome could not close (for example, already closed). */
export async function closeTabs(ids: number[]): Promise<number[]> {
  try {
    await chrome.tabs.remove(ids);
    return [];
  } catch {
    // One bad id rejects the whole batch. Retry one by one to find which ones failed.
    const results = await Promise.allSettled(ids.map((id) => chrome.tabs.remove(id)));
    return ids.filter((_, i) => results[i]?.status === 'rejected');
  }
}

async function openOne(url: string, active: boolean, place?: TabPlace): Promise<chrome.tabs.Tab> {
  if (place) {
    try {
      return await chrome.tabs.create({ url, active, windowId: place.windowId, index: place.index });
    } catch {
      // The original window is gone. Open it in the current window instead.
    }
  }
  return chrome.tabs.create({ url, active });
}

/** Reopens archived pages in the background, at their old place when known. Rejects if any fails. */
export function pageOpener(places: TabPlaces = {}, active = false) {
  return async (records: ArchiveRecord[]): Promise<void> => {
    // Lowest index first so earlier tabs don't shift the positions of later ones.
    const sorted = [...records].sort((a, b) => (places[a.url]?.index ?? 0) - (places[b.url]?.index ?? 0));
    for (const r of sorted) await restoreTabGroup(await openOne(r.url, active, places[r.url]), r.group);
  };
}

/** True when the user has granted page access for text capture. */
export async function hasCaptureAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(CAPTURE_PERMISSIONS);
  } catch {
    return false;
  }
}

/** Reads a tab's text with the in-page extractor. Resolves to null if the page offers nothing. */
export async function readPageText(tabId: number): Promise<unknown> {
  const [first] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageText,
    args: [CAPTURE_LIMITS.maxRawChars],
  });
  return first?.result ?? null;
}

/**
 * The one path every archive takes, by hand or automatic: captures page text where allowed (a paid
 * feature, skipped quietly after the trial), then archives (save first, close after).
 */
export async function runArchive(plan: ArchivePlan, prefs: Preferences): Promise<ArchiveResult> {
  if (prefs.captureText && plan.readable.length > 0 && (await mayUse('pageText')) && (await hasCaptureAccess())) {
    const texts = await captureTexts(plan.readable, readPageText);
    for (const req of plan.requests) {
      const text = texts.get(req.tabId);
      if (text) req.input.text = text;
    }
  }
  const result = await archiveTabs(plan.requests, { closeTabs, now: Date.now() });
  await recordPutAway(result.archivedTabIds.length - result.closeFailedTabIds.length, chrome.storage.local);
  return result;
}

/**
 * Undo that checks the archive first: only pages still archived exactly as this run left them are
 * reopened. Returns how many pages were reopened.
 */
export async function undoIfUnchanged(undo: ArchiveUndo, places: TabPlaces): Promise<number> {
  const still = reconcileUndo(undo, await listArchive());
  if (still.saved.length > 0) {
    await undoArchive(still, pageOpener(places));
    await recordPutAway(-still.saved.length, chrome.storage.local);
  }
  return still.saved.length;
}

export type NotArchivedReason = 'pinned' | 'notWebPage' | 'sensitive' | 'gone';

export type ArchiveNowResult =
  | { ok: true; undo: ArchiveUndo; places: TabPlaces; record: ArchiveRecord }
  | { ok: false; reason: NotArchivedReason };

/**
 * Archives one tab because the user asked to ("Archive this tab" or the keyboard shortcut). It is
 * re-read first, then goes through the same path as every archive: save, then close.
 */
export async function archiveTabNow(tabId: number, prefs: Preferences, label?: string): Promise<ArchiveNowResult> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.incognito) return { ok: false, reason: 'gone' };
  if (tab.pinned) return { ok: false, reason: 'pinned' };
  const [activity, groups] = await Promise.all([
    prefs.trackActivity ? readActivity() : Promise.resolve(EMPTY_ACTIVITY),
    prefs.useTabGroups ? readGroups() : Promise.resolve(undefined),
  ]);
  const plan = planArchive([tab], {
    scorer: createScorer(prefs),
    prefs,
    activity,
    groups,
    label,
    now: Date.now(),
    explicit: true,
  });
  const result = await runArchive(plan, prefs);
  const skipped = result.skipped[0];
  if (skipped) return { ok: false, reason: skipped.reason };
  const record = result.undo.saved[0];
  if (!record) return { ok: false, reason: 'gone' };
  return { ok: true, undo: result.undo, places: plan.places, record };
}
