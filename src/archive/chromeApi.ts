/**
 * Thin Chrome wrappers shared by the side panel and the service worker. Logic stays in the pure
 * modules next to this file.
 */
import { mayArchive } from '../license/store';
import type { Preferences } from '../prefs/types';
import { CAPTURE_LIMITS, CAPTURE_PERMISSIONS, captureTexts, extractPageText } from './capture';
import type { TabPlace, ArchivePlan, TabPlaces } from './plan';
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

async function openOne(url: string, active: boolean, place?: TabPlace): Promise<void> {
  if (place) {
    try {
      await chrome.tabs.create({ url, active, windowId: place.windowId, index: place.index });
      return;
    } catch {
      // The original window is gone. Open it in the current window instead.
    }
  }
  await chrome.tabs.create({ url, active });
}

/** Reopens archived pages in the background, at their old place when known. Rejects if any fails. */
export function pageOpener(places: TabPlaces = {}, active = false) {
  return async (records: ArchiveRecord[]): Promise<void> => {
    // Lowest index first so earlier tabs don't shift the positions of later ones.
    const sorted = [...records].sort((a, b) => (places[a.url]?.index ?? 0) - (places[b.url]?.index ?? 0));
    for (const r of sorted) await openOne(r.url, active, places[r.url]);
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

export type RunResult = { locked: true } | (ArchiveResult & { locked: false });

/**
 * The one path every archive takes, by hand or automatic. Checks the license first (archiving new
 * tabs is the paid feature), then captures page text where allowed, then archives (save first,
 * close after). Nothing is read or closed when locked.
 */
export async function runArchive(plan: ArchivePlan, prefs: Preferences): Promise<RunResult> {
  if (!(await mayArchive())) return { locked: true };
  if (prefs.captureText && plan.readable.length > 0 && (await hasCaptureAccess())) {
    const texts = await captureTexts(plan.readable, readPageText);
    for (const req of plan.requests) {
      const text = texts.get(req.tabId);
      if (text) req.input.text = text;
    }
  }
  return { ...(await archiveTabs(plan.requests, { closeTabs, now: Date.now() })), locked: false };
}

/**
 * Undo that checks the archive first: only pages still archived exactly as this run left them are
 * reopened. Returns how many pages were reopened.
 */
export async function undoIfUnchanged(undo: ArchiveUndo, places: TabPlaces): Promise<number> {
  const still = reconcileUndo(undo, await listArchive());
  if (still.saved.length > 0) await undoArchive(still, pageOpener(places));
  return still.saved.length;
}
