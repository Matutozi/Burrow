import type { Preferences } from './types';
import { sanitizePreferences } from './validate';

const KEY = 'preferences';

/** The subset of chrome.storage.StorageArea Burrow uses, so tests can pass an in-memory fake. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PreferenceAreas {
  /** The user's Chrome profile. Syncs across their devices if Chrome sync is on. */
  sync: StorageAreaLike;
  /** This device only. Used when an item is too big for sync, or sync fails. */
  local: StorageAreaLike;
  /** Max bytes for one sync item. */
  syncItemLimit: number;
}

/** Headroom under Chrome's per-item limit for the key name and encoding overhead. */
const SYNC_HEADROOM_BYTES = 512;

function chromeAreas(): PreferenceAreas {
  const quota = chrome.storage.sync.QUOTA_BYTES_PER_ITEM ?? 8192;
  return { sync: chrome.storage.sync, local: chrome.storage.local, syncItemLimit: quota - SYNC_HEADROOM_BYTES };
}

function updatedAtOf(v: unknown): number {
  const t = (v as { updatedAt?: unknown } | undefined)?.updatedAt;
  return typeof t === 'number' && Number.isFinite(t) ? t : 0;
}

/**
 * Preferences live in the user's own Chrome profile. Burrow runs no server and never sees them.
 * Both areas are read and the most recently saved copy wins, so a failed cleanup in one area
 * can never hide a newer value in the other.
 */
export async function loadPreferences(areas: PreferenceAreas = chromeAreas()): Promise<Preferences> {
  const [synced, local] = await Promise.all([areas.sync.get(KEY), areas.local.get(KEY)]);
  const a = synced[KEY];
  const b = local[KEY];
  const newest = a === undefined ? b : b === undefined ? a : updatedAtOf(b) > updatedAtOf(a) ? b : a;
  return sanitizePreferences(newest);
}

/** Validates, timestamps and saves. Returns what was stored. */
export async function savePreferences(
  prefs: Preferences,
  areas: PreferenceAreas = chromeAreas(),
  now: number = Date.now(),
): Promise<Preferences> {
  const clean = sanitizePreferences({ ...prefs, updatedAt: now });
  const size = new TextEncoder().encode(JSON.stringify(clean)).length;

  if (size <= areas.syncItemLimit) {
    try {
      await areas.sync.set({ [KEY]: clean });
      // Best effort: even if this fails, the newer timestamp in sync wins on the next load.
      await areas.local.remove(KEY).catch(() => undefined);
      return clean;
    } catch (err) {
      console.warn('Burrow: sync storage unavailable, saving preferences on this device', err);
    }
  }
  await areas.local.set({ [KEY]: clean });
  await areas.sync.remove(KEY).catch(() => undefined);
  return clean;
}

/** Calls back with fresh preferences whenever they change in any context or on a synced device. */
export function onPreferencesChanged(cb: (prefs: Preferences) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if ((area === 'sync' || area === 'local') && KEY in changes) {
      loadPreferences().then(cb, (err: unknown) => console.error('Burrow: could not reload preferences', err));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
