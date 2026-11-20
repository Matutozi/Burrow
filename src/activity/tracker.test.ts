import { describe, expect, it } from 'vitest';
import type { StorageAreaLike } from '../prefs/storage';
import { createActivityStore, readActivity } from './store';
import {
  activityFor,
  EMPTY_ACTIVITY,
  focusTab,
  MAX_SEGMENT_MS,
  pruneTabs,
  removeTab,
  replaceTab,
  sanitizeActivity,
} from './tracker';

const MIN = 60_000;

describe('activity tracker', () => {
  it('counts a visit and time on the focused tab', () => {
    let s = focusTab(EMPTY_ACTIVITY, 1, 0);
    s = focusTab(s, 2, 5 * MIN);
    expect(s.tabs['1']).toEqual({ visits: 1, activeMs: 5 * MIN });
    expect(s.tabs['2']).toEqual({ visits: 1, activeMs: 0 });
    expect(s.current).toEqual({ tabId: 2, since: 5 * MIN });
  });

  it('does not count a revisit when focus stays on the same tab', () => {
    let s = focusTab(EMPTY_ACTIVITY, 1, 0);
    s = focusTab(s, 1, MIN);
    expect(s.tabs['1']).toEqual({ visits: 1, activeMs: MIN });
  });

  it('stops the clock when Chrome loses focus or the user goes idle', () => {
    let s = focusTab(EMPTY_ACTIVITY, 1, 0);
    s = focusTab(s, null, 2 * MIN);
    s = focusTab(s, 1, 60 * MIN);
    s = focusTab(s, null, 61 * MIN);
    expect(s.tabs['1']).toEqual({ visits: 2, activeMs: 3 * MIN });
    expect(s.current).toBeNull();
  });

  it('caps one stretch if idle events were missed', () => {
    let s = focusTab(EMPTY_ACTIVITY, 1, 0);
    s = focusTab(s, null, 48 * 60 * MIN);
    expect(s.tabs['1']?.activeMs).toBe(MAX_SEGMENT_MS);
  });

  it('ignores clock going backwards', () => {
    let s = focusTab(EMPTY_ACTIVITY, 1, 10 * MIN);
    s = focusTab(s, null, 5 * MIN);
    expect(s.tabs['1']?.activeMs).toBe(0);
  });

  it('forgets closed tabs', () => {
    let s = focusTab(EMPTY_ACTIVITY, 1, 0);
    s = focusTab(s, 2, MIN);
    s = removeTab(s, 2, 2 * MIN);
    expect(s.tabs['2']).toBeUndefined();
    expect(s.current).toBeNull();
    expect(s.tabs['1']).toEqual({ visits: 1, activeMs: MIN });
  });

  it('moves history when Chrome replaces a tab', () => {
    let s = focusTab(EMPTY_ACTIVITY, 1, 0);
    s = replaceTab(s, 9, 1);
    expect(s.tabs['1']).toBeUndefined();
    expect(s.tabs['9']).toEqual({ visits: 1, activeMs: 0 });
    expect(s.current?.tabId).toBe(9);
  });

  it('prunes tabs that no longer exist', () => {
    let s = focusTab(EMPTY_ACTIVITY, 1, 0);
    s = focusTab(s, 2, MIN);
    s = pruneTabs(s, [1]);
    expect(Object.keys(s.tabs)).toEqual(['1']);
    expect(s.current).toBeNull();
  });

  it('includes the in-progress stretch for the current tab', () => {
    const s = focusTab(EMPTY_ACTIVITY, 1, 0);
    expect(activityFor(s, 1, 3 * MIN)).toEqual({ visits: 1, activeMs: 3 * MIN });
    expect(activityFor(s, 2, 3 * MIN)).toEqual({ visits: 0, activeMs: 0 });
  });

  it('never mutates its input', () => {
    const s = focusTab(EMPTY_ACTIVITY, 1, 0);
    const snapshot = structuredClone(s);
    focusTab(s, 2, MIN);
    removeTab(s, 1, MIN);
    expect(s).toEqual(snapshot);
  });
});

describe('sanitizeActivity', () => {
  it('repairs corrupt data', () => {
    expect(sanitizeActivity('junk')).toEqual(EMPTY_ACTIVITY);
    expect(
      sanitizeActivity({
        current: { tabId: 'x', since: 1 },
        tabs: { '1': { visits: -3, activeMs: 'lots' }, abc: { visits: 1, activeMs: 1 }, '2': null, '3': { visits: 2.7, activeMs: 50 } },
      }),
    ).toEqual({ current: null, tabs: { '1': { visits: 0, activeMs: 0 }, '3': { visits: 2, activeMs: 50 } } });
  });
});

class SlowArea implements StorageAreaLike {
  data: Record<string, unknown> = {};
  async get(key: string) {
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    return key in this.data ? { [key]: structuredClone(this.data[key]) } : {};
  }
  async set(items: Record<string, unknown>) {
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    Object.assign(this.data, structuredClone(items));
  }
  async remove(key: string) {
    delete this.data[key];
  }
}

describe('activity store', () => {
  it('loses no updates when events overlap', async () => {
    const area = new SlowArea();
    const store = createActivityStore(area);
    // 50 rapid switches between two tabs, all fired without waiting.
    await Promise.all(Array.from({ length: 50 }, (_, i) => store.update((s) => focusTab(s, (i % 2) + 1, i * 1000))));
    const s = await readActivity(area);
    expect((s.tabs['1']?.visits ?? 0) + (s.tabs['2']?.visits ?? 0)).toBe(50);
  });

  it('keeps working after a failed update', async () => {
    const area = new SlowArea();
    const store = createActivityStore(area);
    await expect(store.update(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    await store.update((s) => focusTab(s, 1, 0));
    expect((await readActivity(area)).tabs['1']?.visits).toBe(1);
  });
});

describe('activity store writes', () => {
  it('skips the write when the reducer returns the same state', async () => {
    const area = new SlowArea();
    let writes = 0;
    const set = area.set.bind(area);
    area.set = async (items) => {
      writes++;
      await set(items);
    };
    const store = createActivityStore(area);
    await store.update((s) => s);
    expect(writes).toBe(0);
    await store.update((s) => focusTab(s, 1, 0));
    expect(writes).toBe(1);
  });
});
