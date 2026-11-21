/**
 * Where the license key and trial start live. Both are kept in sync storage (the user's own Chrome
 * profile, so a key entered once works on all their devices) and in local storage as a fallback.
 * Storage areas are injected so this is unit-tested with fakes. Nothing read from storage is
 * trusted: the key is re-verified on every read and the trial start is validated.
 */
import type { StorageAreaLike } from '../prefs/storage';
import { canArchive, entitlement, type Entitlement } from './entitlement';
import { MAX_KEY_LENGTH, normalizeKey, verifyLicenseKey, type LicenseInfo } from './key';
import { LICENSE_PUBLIC_KEY } from './publicKey';

export const LICENSE_KEY = 'licenseKey';
export const TRIAL_KEY = 'trialStartedAt';

export interface LicenseAreas {
  sync: StorageAreaLike;
  local: StorageAreaLike;
}

function chromeAreas(): LicenseAreas {
  return { sync: chrome.storage.sync, local: chrome.storage.local };
}

/** A usable trial start, or null. Rejects non-numbers and future dates (clock tricks or corrupt data). */
function validStart(v: unknown, now: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= now ? v : null;
}

async function readBoth(key: string, areas: LicenseAreas): Promise<unknown[]> {
  const results = await Promise.allSettled([areas.sync.get(key), areas.local.get(key)]);
  return results.map((r) => (r.status === 'fulfilled' ? r.value[key] : undefined));
}

/** Writes to both areas; succeeds if at least one write does. */
async function writeBoth(items: Record<string, unknown>, areas: LicenseAreas): Promise<void> {
  const results = await Promise.allSettled([areas.sync.set(items), areas.local.set(items)]);
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (results.every((r) => r.status === 'rejected')) throw failure?.reason;
}

/**
 * The trial start date. The earliest valid copy wins, so clearing one storage area doesn't restart
 * the trial. Starts the trial now if there is none yet.
 */
export async function ensureTrialStarted(
  areas: LicenseAreas = chromeAreas(),
  now: number = Date.now(),
): Promise<number> {
  const copies = (await readBoth(TRIAL_KEY, areas))
    .map((v) => validStart(v, now))
    .filter((v): v is number => v !== null);
  const start = copies.length > 0 ? Math.min(...copies) : now;
  if (copies.length < 2 || copies.some((c) => c !== start)) await writeBoth({ [TRIAL_KEY]: start }, areas);
  return start;
}

/** The stored key, if it is genuine. */
export async function readLicense(
  areas: LicenseAreas = chromeAreas(),
  publicKey: JsonWebKey = LICENSE_PUBLIC_KEY,
): Promise<LicenseInfo | null> {
  for (const v of await readBoth(LICENSE_KEY, areas)) {
    if (typeof v !== 'string' || v.length > MAX_KEY_LENGTH) continue;
    const info = await verifyLicenseKey(v, publicKey);
    if (info) return info;
  }
  return null;
}

export async function readStoredKey(areas: LicenseAreas = chromeAreas()): Promise<string | null> {
  for (const v of await readBoth(LICENSE_KEY, areas)) if (typeof v === 'string') return v;
  return null;
}

/** Verifies and saves a key. Returns null (and saves nothing) if the key isn't genuine. */
export async function activateLicense(
  input: string,
  areas: LicenseAreas = chromeAreas(),
  publicKey: JsonWebKey = LICENSE_PUBLIC_KEY,
): Promise<LicenseInfo | null> {
  const key = normalizeKey(input);
  const info = await verifyLicenseKey(key, publicKey);
  if (!info) return null;
  await writeBoth({ [LICENSE_KEY]: key }, areas);
  return info;
}

/** Removes the key from this profile. Returns it, so the caller can offer undo. */
export async function removeLicense(areas: LicenseAreas = chromeAreas()): Promise<string | null> {
  const key = await readStoredKey(areas);
  await Promise.all([areas.sync.remove(LICENSE_KEY), areas.local.remove(LICENSE_KEY)]);
  return key;
}

export async function currentEntitlement(
  areas: LicenseAreas = chromeAreas(),
  now: number = Date.now(),
  publicKey: JsonWebKey = LICENSE_PUBLIC_KEY,
): Promise<Entitlement> {
  const [license, start] = await Promise.all([readLicense(areas, publicKey), ensureTrialStarted(areas, now)]);
  return entitlement(license, start, now);
}

export async function mayArchive(areas: LicenseAreas = chromeAreas(), now: number = Date.now()): Promise<boolean> {
  return canArchive(await currentEntitlement(areas, now));
}

/** Calls back when the license or trial changes in any context. */
export function onLicenseChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if ((area === 'sync' || area === 'local') && (LICENSE_KEY in changes || TRIAL_KEY in changes)) cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
