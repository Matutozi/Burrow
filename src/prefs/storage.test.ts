import { describe, expect, it } from 'vitest';
import { defaultPreferences } from './defaults';
import { loadPreferences, savePreferences, type PreferenceAreas, type StorageAreaLike } from './storage';

class FakeArea implements StorageAreaLike {
  data = new Map<string, unknown>();
  failSet = false;
  failRemove = false;
  async get(key: string) {
    return this.data.has(key) ? { [key]: structuredClone(this.data.get(key)) } : {};
  }
  async set(items: Record<string, unknown>) {
    if (this.failSet) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
    for (const [k, v] of Object.entries(items)) this.data.set(k, structuredClone(v));
  }
  async remove(key: string) {
    if (this.failRemove) throw new Error('remove failed');
    this.data.delete(key);
  }
}

function areas(limit = 8000) {
  const sync = new FakeArea();
  const local = new FakeArea();
  const a: PreferenceAreas = { sync, local, syncItemLimit: limit };
  return { sync, local, a };
}

describe('preference storage', () => {
  it('returns defaults when nothing is stored', async () => {
    const { a } = areas();
    expect(await loadPreferences(a)).toEqual(defaultPreferences());
  });

  it('saves to sync and round-trips with a timestamp', async () => {
    const { a, sync, local } = areas();
    const saved = await savePreferences({ ...defaultPreferences(), topics: ['react'] }, a, 1000);
    expect(saved.updatedAt).toBe(1000);
    expect(sync.data.has('preferences')).toBe(true);
    expect(local.data.has('preferences')).toBe(false);
    expect(await loadPreferences(a)).toEqual(saved);
  });

  it('falls back to local when preferences are too big for sync', async () => {
    const { a, sync, local } = areas(100);
    await savePreferences(defaultPreferences(), a, 1);
    expect(local.data.has('preferences')).toBe(true);
    expect(sync.data.has('preferences')).toBe(false);
  });

  it('falls back to local when sync rejects the write', async () => {
    const { a, sync, local } = areas();
    sync.failSet = true;
    await savePreferences({ ...defaultPreferences(), topics: ['kept'] }, a, 1);
    expect((await loadPreferences(a)).topics).toEqual(['kept']);
    expect(local.data.has('preferences')).toBe(true);
  });

  it('never lets a stale copy hide a newer one when cleanup fails', async () => {
    const { a, sync } = areas();
    await savePreferences({ ...defaultPreferences(), topics: ['old'] }, a, 1);
    sync.failSet = true;
    sync.failRemove = true;
    await savePreferences({ ...defaultPreferences(), topics: ['new'] }, a, 2);
    expect(sync.data.has('preferences')).toBe(true); // stale copy still there
    expect((await loadPreferences(a)).topics).toEqual(['new']);
  });

  it('repairs corrupt stored data on load', async () => {
    const { a, sync } = areas();
    sync.data.set('preferences', { topics: 'oops', staleAfterDays: 'NaN' });
    const p = await loadPreferences(a);
    expect(p.topics).toEqual([]);
    expect(p.staleAfterDays).toBe(3);
  });

  it('sanitizes before saving', async () => {
    const { a } = areas();
    const saved = await savePreferences({ ...defaultPreferences(), archiveThreshold: 9999 }, a, 1);
    expect(saved.archiveThreshold).toBe(100);
  });
});
