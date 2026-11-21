import { describe, expect, it } from 'vitest';
import { generateKeyPair, issueKey } from '../../scripts/license.mjs';
import type { StorageAreaLike } from '../prefs/storage';
import { canArchive, entitlement, TRIAL_DAYS } from './entitlement';
import { verifyLicenseKey } from './key';
import { LICENSE_PUBLIC_KEY } from './publicKey';
import {
  activateLicense,
  currentEntitlement,
  ensureTrialStarted,
  LICENSE_KEY,
  readLicense,
  removeLicense,
  TRIAL_KEY,
  type LicenseAreas,
} from './store';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

class FakeArea implements StorageAreaLike {
  data = new Map<string, unknown>();
  failSet = false;
  async get(key: string) {
    return this.data.has(key) ? { [key]: structuredClone(this.data.get(key)) } : {};
  }
  async set(items: Record<string, unknown>) {
    if (this.failSet) throw new Error('sync unavailable');
    for (const [k, v] of Object.entries(items)) this.data.set(k, structuredClone(v));
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

function areas() {
  const sync = new FakeArea();
  const local = new FakeArea();
  return { sync, local, a: { sync, local } satisfies LicenseAreas };
}

const seller = await generateKeyPair();
const other = await generateKeyPair();

describe('license keys', () => {
  it('accepts a key issued by the seller script', async () => {
    const key = await issueKey(seller.privateJwk, 'order-1001', 123);
    expect(key).toMatch(/^BRW1-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifyLicenseKey(key, seller.publicJwk)).toEqual({ id: 'order-1001', issuedAt: 123 });
  });

  it('tolerates spaces and line breaks from copy-paste', async () => {
    const key = await issueKey(seller.privateJwk, 'order-2', 1);
    const mangled = `  ${key.slice(0, 20)}\n${key.slice(20, 50)} ${key.slice(50)}\n`;
    expect(await verifyLicenseKey(mangled, seller.publicJwk)).not.toBeNull();
  });

  it('rejects keys signed by someone else, edited, truncated or malformed', async () => {
    const key = await issueKey(seller.privateJwk, 'order-3', 1);
    expect(await verifyLicenseKey(await issueKey(other.privateJwk, 'order-3', 1), seller.publicJwk)).toBeNull();
    const [payload, sig] = key.slice(5).split('.');
    const forged = btoa(JSON.stringify({ v: 1, id: 'free-for-all', iat: 1 })).replace(/=+$/, '');
    expect(await verifyLicenseKey(`BRW1-${forged}.${sig}`, seller.publicJwk)).toBeNull();
    expect(await verifyLicenseKey(key.slice(0, -4), seller.publicJwk)).toBeNull();
    expect(await verifyLicenseKey(`BRW1-${payload}`, seller.publicJwk)).toBeNull();
    expect(await verifyLicenseKey(`BRW1-${payload}.${sig}.x`, seller.publicJwk)).toBeNull();
    expect(await verifyLicenseKey(key.replace('BRW1-', 'BRW2-'), seller.publicJwk)).toBeNull();
    expect(await verifyLicenseKey('', seller.publicJwk)).toBeNull();
    expect(await verifyLicenseKey('BRW1-!!!.???', seller.publicJwk)).toBeNull();
  });

  it('rejects signed payloads with the wrong shape', async () => {
    await expect(issueKey(seller.privateJwk, '', 1)).rejects.toThrow();
    await expect(issueKey(seller.privateJwk, 'x'.repeat(65), 1)).rejects.toThrow();
  });

  it('ships a valid public key', async () => {
    await expect(
      crypto.subtle.importKey('jwk', LICENSE_PUBLIC_KEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
    ).resolves.toBeDefined();
  });
});

describe('entitlement', () => {
  it(`gives a ${TRIAL_DAYS}-day trial, then locks archiving until licensed`, () => {
    const start = NOW;
    const day1 = entitlement(null, start, NOW + 1000);
    expect(day1).toEqual({ status: 'trial', daysLeft: TRIAL_DAYS, endsAt: NOW + TRIAL_DAYS * DAY });
    expect(entitlement(null, start, NOW + (TRIAL_DAYS - 0.5) * DAY)).toMatchObject({ status: 'trial', daysLeft: 1 });
    const over = entitlement(null, start, NOW + TRIAL_DAYS * DAY);
    expect(over.status).toBe('expired');
    expect(canArchive(over)).toBe(false);
    expect(canArchive(entitlement({ id: 'o', issuedAt: 1 }, start, NOW + 999 * DAY))).toBe(true);
  });
});

describe('license storage', () => {
  it('starts the trial once and keeps the earliest start across areas', async () => {
    const { a, sync, local } = areas();
    expect(await ensureTrialStarted(a, NOW)).toBe(NOW);
    expect(await ensureTrialStarted(a, NOW + 5 * DAY)).toBe(NOW);
    // Clearing one area doesn't restart the trial.
    local.data.delete(TRIAL_KEY);
    expect(await ensureTrialStarted(a, NOW + 6 * DAY)).toBe(NOW);
    expect(local.data.get(TRIAL_KEY)).toBe(NOW);
    // An earlier copy anywhere wins.
    sync.data.set(TRIAL_KEY, NOW - DAY);
    expect(await ensureTrialStarted(a, NOW + 6 * DAY)).toBe(NOW - DAY);
  });

  it('ignores corrupt or future trial dates', async () => {
    const { a, sync, local } = areas();
    sync.data.set(TRIAL_KEY, NOW + 100 * DAY);
    local.data.set(TRIAL_KEY, 'yesterday');
    expect(await ensureTrialStarted(a, NOW)).toBe(NOW);
  });

  it('still works when sync storage is unavailable', async () => {
    const { a, sync } = areas();
    sync.failSet = true;
    expect(await ensureTrialStarted(a, NOW)).toBe(NOW);
    const key = await issueKey(seller.privateJwk, 'order-9', 1);
    expect(await activateLicense(key, a, seller.publicJwk)).not.toBeNull();
    expect(await readLicense(a, seller.publicJwk)).toEqual({ id: 'order-9', issuedAt: 1 });
  });

  it('saves only genuine keys, re-verifies on read, and can remove', async () => {
    const { a, sync, local } = areas();
    expect(await activateLicense('BRW1-nope.nope', a, seller.publicJwk)).toBeNull();
    expect(sync.data.has(LICENSE_KEY)).toBe(false);

    const key = await issueKey(seller.privateJwk, 'order-7', 5);
    expect(await activateLicense(` ${key}\n`, a, seller.publicJwk)).toEqual({ id: 'order-7', issuedAt: 5 });
    expect(sync.data.get(LICENSE_KEY)).toBe(key);

    // A key edited in storage is not trusted.
    sync.data.set(LICENSE_KEY, key.slice(0, -2) + 'AA');
    local.data.set(LICENSE_KEY, 42);
    expect(await readLicense(a, seller.publicJwk)).toBeNull();

    sync.data.set(LICENSE_KEY, key);
    expect(await removeLicense(a)).toBe(key);
    expect(await readLicense(a, seller.publicJwk)).toBeNull();
  });

  it('reports the current entitlement', async () => {
    const { a } = areas();
    expect((await currentEntitlement(a, NOW, seller.publicJwk)).status).toBe('trial');
    expect((await currentEntitlement(a, NOW + (TRIAL_DAYS + 1) * DAY, seller.publicJwk)).status).toBe('expired');
    await activateLicense(await issueKey(seller.privateJwk, 'order-8', 1), a, seller.publicJwk);
    expect((await currentEntitlement(a, NOW + 400 * DAY, seller.publicJwk)).status).toBe('licensed');
  });
});
