import { CAPTURE_LIMITS, CAPTURE_PERMISSIONS, extractPageText } from '../archive/capture';
import type { ArchiveRecord } from '../archive/record';

/** Where a tab was, so undo can put it back in the same window and position. */
export interface TabPlace {
  windowId: number;
  index: number;
}

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
export function pageOpener(places: Map<string, TabPlace> = new Map(), active = false) {
  return async (records: ArchiveRecord[]): Promise<void> => {
    // Lowest index first so earlier tabs don't shift the positions of later ones.
    const sorted = [...records].sort((a, b) => (places.get(a.url)?.index ?? 0) - (places.get(b.url)?.index ?? 0));
    for (const r of sorted) await openOne(r.url, active, places.get(r.url));
  };
}

/** Saves a JSON file through the browser's normal download flow. No permission or network needed. */
export function downloadJson(data: unknown, fileName: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True when the user has granted page access for text capture. */
export async function hasCaptureAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(CAPTURE_PERMISSIONS);
  } catch {
    return false;
  }
}

/** Asks Chrome for page access. Must be called from a click, before any other await. */
export function requestCaptureAccess(): Promise<boolean> {
  return chrome.permissions.request(CAPTURE_PERMISSIONS);
}

/** Gives page access back when the user turns capture off. */
export async function releaseCaptureAccess(): Promise<void> {
  await chrome.permissions.remove(CAPTURE_PERMISSIONS);
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
