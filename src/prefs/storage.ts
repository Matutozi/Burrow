import { defaultPreferences, DEFAULT_WEIGHTS } from './defaults';
import type { Preferences } from './types';

const KEY = 'preferences';

/**
 * Chrome sync storage allows 8 KB per item. Preferences normally use well under 2 KB,
 * but long site lists could exceed that, so leave headroom and fall back to local.
 */
const SYNC_ITEM_LIMIT = 7_000;

/** Fills in any fields missing from older saved versions. */
export function withDefaults(saved: Partial<Preferences> | undefined): Preferences {
  const base = defaultPreferences(saved?.persona);
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    contentPriority: { ...base.contentPriority, ...saved.contentPriority },
    indexPolicy: { ...base.indexPolicy, ...saved.indexPolicy },
    weights: { ...DEFAULT_WEIGHTS, ...saved.weights },
  };
}

/**
 * Preferences live in the user's own Chrome profile. With Chrome sync on, they follow the user
 * to their other devices. Burrow runs no server and never sees them.
 * Only preferences sync: archived pages and activity history stay on this device.
 */
export async function loadPreferences(): Promise<Preferences> {
  const [synced, local] = await Promise.all([chrome.storage.sync.get(KEY), chrome.storage.local.get(KEY)]);
  return withDefaults((synced[KEY] ?? local[KEY]) as Partial<Preferences> | undefined);
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  const size = new TextEncoder().encode(JSON.stringify({ [KEY]: prefs })).length;
  if (size <= SYNC_ITEM_LIMIT) {
    try {
      await chrome.storage.sync.set({ [KEY]: prefs });
      await chrome.storage.local.remove(KEY);
      return;
    } catch (err) {
      // Quota or rate limit hit: keep the user's change locally rather than losing it.
      console.warn('Burrow: sync storage unavailable, saving preferences locally', err);
    }
  }
  await chrome.storage.local.set({ [KEY]: prefs });
  await chrome.storage.sync.remove(KEY).catch(() => undefined);
}

/** Calls back whenever preferences change in any extension context or synced device. Returns an unsubscribe function. */
export function onPreferencesChanged(cb: (prefs: Preferences) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if ((area === 'sync' || area === 'local') && KEY in changes) {
      // A removal in one area just means the value moved to the other, so reload the source of truth.
      loadPreferences().then(cb, (err: unknown) => console.error('Burrow: could not reload preferences', err));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
