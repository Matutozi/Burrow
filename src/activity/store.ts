import type { StorageAreaLike } from '../prefs/storage';
import { EMPTY_ACTIVITY, sanitizeActivity, type ActivityState } from './tracker';

const KEY = 'activity';

/**
 * Activity lives in chrome.storage.session: held in memory, never written to disk, cleared when
 * Chrome closes, and not readable by web pages or content scripts.
 */
function sessionArea(): StorageAreaLike {
  return chrome.storage.session;
}

export async function readActivity(area: StorageAreaLike = sessionArea()): Promise<ActivityState> {
  const got = await area.get(KEY);
  return sanitizeActivity(got[KEY]);
}

export interface ActivityStore {
  /**
   * Applies `fn` to the latest state and saves it. Calls run strictly one after another, so `fn`
   * may await (for example to ask Chrome which tab is focused) without racing other updates.
   */
  update(fn: (state: ActivityState) => ActivityState | Promise<ActivityState>): Promise<ActivityState>;
  clear(): Promise<void>;
}

/**
 * Serialises read-modify-write cycles. Chrome can fire several tab events at once, and without
 * this, two overlapping updates could each read the old state and one count would be lost.
 */
export function createActivityStore(area: StorageAreaLike = sessionArea()): ActivityStore {
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  }

  return {
    update: (fn) =>
      enqueue(async () => {
        const prev = await readActivity(area);
        const next = await fn(prev);
        // Reducers return the same object when nothing changed. Skip the write and the change event.
        if (next !== prev) await area.set({ [KEY]: next });
        return next;
      }),
    clear: () => enqueue(() => area.remove(KEY)),
  };
}

export function onActivityChanged(cb: (state: ActivityState) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName === 'session' && KEY in changes) cb(sanitizeActivity(changes[KEY]?.newValue ?? EMPTY_ACTIVITY));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
