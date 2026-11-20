import { describe, expect, it } from 'vitest';
import { buildRecord, recordId, sanitizeRecord, searchRecords, type ArchiveRecord } from './record';
import { archiveTabs, listArchive, removeRecords, restoreRecords, undoArchive, type ArchiveArea, type ArchiveRequest } from './store';

class FakeArea implements ArchiveArea {
  data = new Map<string, unknown>();
  failSet = false;
  writes = 0;
  async get(keys: string[] | null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.data) if (keys === null || keys.includes(k)) out[k] = structuredClone(v);
    return out;
  }
  async set(items: Record<string, unknown>) {
    if (this.failSet) throw new Error('QUOTA_BYTES quota exceeded');
    this.writes++;
    for (const [k, v] of Object.entries(items)) this.data.set(k, structuredClone(v));
  }
  async remove(keys: string[]) {
    for (const k of keys) this.data.delete(k);
  }
}

const req = (tabId: number, url: string, policy: ArchiveRequest['policy'] = 'full'): ArchiveRequest => ({
  tabId,
  input: { url, title: `Tab ${tabId}`, contentType: 'article', score: 12 },
  policy,
});

function setup() {
  const area = new FakeArea();
  const closed: number[] = [];
  const closeTabs = async (ids: number[]) => {
    closed.push(...ids);
    return [];
  };
  return { area, closed, closeTabs };
}

describe('archive records', () => {
  it('builds a title-only record and refuses sensitive or browser pages', async () => {
    const rec = await buildRecord({ url: 'https://a.com/x', title: '  Hello ', contentType: 'docs', score: 140 }, 'full', 5);
    expect(rec).toMatchObject({ url: 'https://a.com/x', title: 'Hello', score: 100, archivedAt: 5, saved: 'title' });
    expect(await buildRecord({ url: 'https://bank.com', title: '', contentType: 'finance', score: 1 }, 'never', 5)).toBeNull();
    expect(await buildRecord({ url: 'chrome://newtab/', title: '', contentType: 'other', score: 1 }, 'full', 5)).toBeNull();
  });

  it('gives the same URL the same id', async () => {
    expect(await recordId('https://a.com')).toBe(await recordId('https://a.com'));
    expect(await recordId('https://a.com')).not.toBe(await recordId('https://b.com'));
    expect(await recordId('https://a.com')).toMatch(/^[0-9a-f]{24}$/);
  });

  it('repairs or rejects corrupt stored records', () => {
    expect(sanitizeRecord('junk', 'x')).toBeNull();
    expect(sanitizeRecord({ url: 'javascript:alert(1)' }, 'x')).toBeNull();
    expect(sanitizeRecord({ url: 'https://a.com', score: 'NaN', contentType: 'nope', archivedAt: -4 }, 'x')).toEqual({
      v: 2,
      id: 'x',
      url: 'https://a.com',
      title: '',
      contentType: 'other',
      score: 0,
      archivedAt: 0,
      saved: 'title',
    });
  });

  it('matches every query word against title and address', () => {
    const recs = [
      { title: 'React hooks guide', url: 'https://react.dev/learn' },
      { title: 'Cooking pasta', url: 'https://food.com/pasta' },
    ] as ArchiveRecord[];
    expect(searchRecords(recs, 'REACT learn')).toHaveLength(1);
    expect(searchRecords(recs, 'food pasta')[0]?.title).toBe('Cooking pasta');
    expect(searchRecords(recs, '  ')).toHaveLength(2);
    expect(searchRecords(recs, 'react pasta')).toHaveLength(0);
  });
});

describe('archiving tabs', () => {
  it('saves records in one write before closing tabs', async () => {
    const { area, closeTabs } = setup();
    const order: string[] = [];
    const result = await archiveTabs([req(1, 'https://a.com'), req(2, 'https://b.com')], {
      area,
      now: 10,
      closeTabs: async (ids) => {
        order.push(`close after ${area.writes} write(s)`);
        return closeTabs(ids);
      },
    });
    expect(area.writes).toBe(1);
    expect(order).toEqual(['close after 1 write(s)']);
    expect(result.archivedTabIds).toEqual([1, 2]);
    expect((await listArchive(area)).map((r) => r.url).sort()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('closes nothing when saving fails', async () => {
    const { area, closed, closeTabs } = setup();
    area.failSet = true;
    await expect(archiveTabs([req(1, 'https://a.com')], { area, now: 1, closeTabs })).rejects.toThrow();
    expect(closed).toEqual([]);
  });

  it('skips sensitive and browser pages and leaves them open', async () => {
    const { area, closed, closeTabs } = setup();
    const result = await archiveTabs([req(1, 'https://mail.com', 'never'), req(2, 'chrome://settings'), req(3, 'https://ok.com')], {
      area,
      now: 1,
      closeTabs,
    });
    expect(closed).toEqual([3]);
    expect(result.skipped).toEqual([
      { tabId: 1, reason: 'sensitive' },
      { tabId: 2, reason: 'notWebPage' },
    ]);
  });

  it('falls back to titles only when storage is too full for page text', async () => {
    const { area, closed, closeTabs } = setup();
    const set = area.set.bind(area);
    area.set = async (items) => {
      if (JSON.stringify(items).includes('"text"')) throw new Error('QUOTA_BYTES quota exceeded');
      return set(items);
    };
    const withText = { ...req(1, 'https://a.com'), input: { ...req(1, 'https://a.com').input, text: 'page body' } };
    const result = await archiveTabs([withText], { area, now: 1, closeTabs });
    expect(result.textDropped).toBe(true);
    expect(closed).toEqual([1]);
    expect((await listArchive(area))[0]).toMatchObject({ saved: 'title' });
    expect((await listArchive(area))[0]).not.toHaveProperty('text');
  });

  it('reports tabs Chrome could not close and keeps their records', async () => {
    const { area } = setup();
    const result = await archiveTabs([req(1, 'https://a.com')], { area, now: 1, closeTabs: async (ids) => ids });
    expect(result.closeFailedTabIds).toEqual([1]);
    expect(await listArchive(area)).toHaveLength(1);
  });

  it('stores one record for duplicate tabs of the same page', async () => {
    const { area, closed, closeTabs } = setup();
    await archiveTabs([req(1, 'https://a.com'), req(2, 'https://a.com')], { area, now: 1, closeTabs });
    expect(closed).toEqual([1, 2]);
    expect(await listArchive(area)).toHaveLength(1);
  });

  it('lists newest first and ignores unrelated keys', async () => {
    const { area, closeTabs } = setup();
    area.data.set('preferences', { topics: [] });
    await archiveTabs([req(1, 'https://old.com')], { area, now: 1, closeTabs });
    await archiveTabs([req(2, 'https://new.com')], { area, now: 2, closeTabs });
    expect((await listArchive(area)).map((r) => r.url)).toEqual(['https://new.com', 'https://old.com']);
  });
});

describe('undo and restore', () => {
  it('undo reopens pages, then removes new records and restores earlier ones', async () => {
    const { area, closeTabs } = setup();
    await archiveTabs([{ ...req(1, 'https://a.com'), input: { ...req(1, 'https://a.com').input, title: 'First' } }], {
      area,
      now: 1,
      closeTabs,
    });
    const second = await archiveTabs([req(2, 'https://a.com'), req(3, 'https://b.com')], { area, now: 2, closeTabs });

    const opened: string[] = [];
    await undoArchive(second.undo, async (recs) => void opened.push(...recs.map((r) => r.url)), area);
    expect(opened.sort()).toEqual(['https://a.com', 'https://b.com']);
    const left = await listArchive(area);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ url: 'https://a.com', title: 'First', archivedAt: 1 });
  });

  it('undo keeps records when pages could not be reopened', async () => {
    const { area, closeTabs } = setup();
    const res = await archiveTabs([req(1, 'https://a.com')], { area, now: 1, closeTabs });
    await expect(
      undoArchive(res.undo, async () => Promise.reject(new Error('no window')), area),
    ).rejects.toThrow();
    expect(await listArchive(area)).toHaveLength(1);
  });

  it('restore opens before removing, and removal returns records for undo', async () => {
    const { area, closeTabs } = setup();
    await archiveTabs([req(1, 'https://a.com'), req(2, 'https://b.com')], { area, now: 1, closeTabs });
    const [first] = await listArchive(area);
    if (!first) throw new Error('missing');

    await expect(restoreRecords([first], async () => Promise.reject(new Error('x')), area)).rejects.toThrow();
    expect(await listArchive(area)).toHaveLength(2);

    expect(await restoreRecords([first], async () => undefined, area)).toEqual([first]);
    const removed = await removeRecords((await listArchive(area)).map((r) => r.id), area);
    expect(removed).toHaveLength(1);
    expect(await listArchive(area)).toHaveLength(0);
  });
});
