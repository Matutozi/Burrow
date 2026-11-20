import { describe, expect, it } from 'vitest';
import { defaultPreferences } from '../prefs/defaults';
import { loadPreferences, savePreferences, type PreferenceAreas, type StorageAreaLike } from '../prefs/storage';
import { deleteAllData, restoreAllData, type DataAreas } from './allData';
import { AUTO_RUN_KEY, readAutoRun, recordAutoRun } from './autoRun';
import { buildExport } from './export';
import { importRecords, parseImport, recordsToWrite, undoImport } from './importData';
import { escapeXml, highlight, resolveEntered, suggest } from './omnibox';
import { buildRecord, createArchiveSearch, recordId, type ArchiveRecord } from './record';
import { listArchive, putRecords, type ArchiveArea } from './store';

class FakeArea implements ArchiveArea, StorageAreaLike {
  data = new Map<string, unknown>();
  async get(keys: string | string[] | null) {
    const want = keys === null ? null : Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.data) if (want === null || want.includes(k)) out[k] = structuredClone(v);
    return out;
  }
  async set(items: Record<string, unknown>) {
    for (const [k, v] of Object.entries(items)) this.data.set(k, structuredClone(v));
  }
  async remove(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.data.delete(k);
  }
}

async function rec(url: string, archivedAt: number, title = url, text?: string): Promise<ArchiveRecord> {
  const r = await buildRecord({ url, title, contentType: 'article', score: 5, text }, 'full', archivedAt);
  if (!r) throw new Error('not archivable');
  return r;
}

describe('address bar search', () => {
  it('escapes XML and highlights every query word', () => {
    expect(escapeXml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
    expect(highlight('React & Redux guide', 'redux react')).toBe('<match>React</match> &amp; <match>Redux</match> guide');
    expect(highlight('<b>', '')).toBe('&lt;b&gt;');
    expect(highlight('aaa', 'a')).toBe('<match>aaa</match>');
  });

  it('suggests matches with the address as content, and nothing for an empty query', async () => {
    const records = [await rec('https://react.dev/learn', 1, 'Learn <React>'), await rec('https://b.com', 2, 'Other')];
    const search = createArchiveSearch(records);
    expect(suggest(search, '  ', 'archived')).toEqual([]);
    const [s] = suggest(search, 'react', 'archived');
    expect(s?.content).toBe('https://react.dev/learn');
    expect(s?.description).toBe('Learn &lt;<match>React</match>&gt; <dim>· archived · react.dev</dim>');
  });

  it('opens the picked suggestion, else the best match for typed words', async () => {
    const a = await rec('https://a.com/x', 1, 'Alpha');
    const b = await rec('https://b.com/y', 2, 'Beta');
    const search = createArchiveSearch([a, b]);
    expect(resolveEntered('https://b.com/y', [a, b], search)).toBe(b);
    expect(resolveEntered('alpha', [a, b], search)).toBe(a);
    expect(resolveEntered('nothing here', [a, b], search)).toBeNull();
  });
});

describe('import', () => {
  it('rejects files that are not Burrow exports', async () => {
    expect(await parseImport('{oops')).toBe('notJson');
    expect(await parseImport('{"format":"other"}')).toBe('notBurrow');
    expect(await parseImport('[]')).toBe('notBurrow');
  });

  it('sanitises records, recomputes ids, and keeps the newest duplicate', async () => {
    const file = JSON.stringify({
      format: 'burrow-export',
      preferences: { topics: ['Imported'], archiveThreshold: 9999 },
      archive: [
        { id: 'forged', url: 'https://a.com', title: 'old', archivedAt: 1 },
        { id: 'x', url: 'https://a.com', title: 'new', archivedAt: 5 },
        { url: 'javascript:alert(1)', archivedAt: 9 },
        'junk',
      ],
    });
    const parsed = await parseImport(file);
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({ id: await recordId('https://a.com'), title: 'new' });
    expect(parsed.preferences?.topics).toEqual(['imported']);
    expect(parsed.preferences?.archiveThreshold).toBe(100);
  });

  it('round-trips an export', async () => {
    const records = [await rec('https://a.com', 3, 'A', 'body text')];
    const parsed = await parseImport(JSON.stringify(buildExport(defaultPreferences(), records, 0)));
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(parsed.records).toEqual(records);
  });

  it('never lets an older copy overwrite a newer archive entry, and undo restores what it replaced', async () => {
    const area = new FakeArea();
    const keepNewer = await rec('https://a.com', 10, 'current');
    const replaceOlder = await rec('https://b.com', 1, 'old b');
    await putRecords([keepNewer, replaceOlder], area);

    const incoming = [await rec('https://a.com', 5, 'stale'), await rec('https://b.com', 7, 'new b'), await rec('https://c.com', 2)];
    expect(recordsToWrite([keepNewer, replaceOlder], incoming).map((r) => r.url)).toEqual(['https://b.com', 'https://c.com']);

    const result = await importRecords(incoming, area);
    expect(result.unchanged).toBe(1);
    const titles = Object.fromEntries((await listArchive(area)).map((r) => [r.url, r.title]));
    expect(titles).toEqual({ 'https://a.com': 'current', 'https://b.com': 'new b', 'https://c.com': 'https://c.com' });

    await undoImport(result, area);
    expect((await listArchive(area)).sort((x, y) => x.url.localeCompare(y.url))).toEqual([keepNewer, replaceOlder]);
  });
});

describe('delete all data', () => {
  function areas(): DataAreas & { local: FakeArea; session: FakeArea; sync: FakeArea } {
    const sync = new FakeArea();
    const prefsLocal = new FakeArea();
    const prefs: PreferenceAreas = { sync, local: prefsLocal, syncItemLimit: 8000 };
    return { prefs, local: new FakeArea(), session: new FakeArea(), sync };
  }

  it('removes preferences, archive, undo record and activity, and undo brings them back', async () => {
    const a = areas();
    await savePreferences({ ...defaultPreferences(), onboarded: true, topics: ['mine'] }, a.prefs, 1);
    await putRecords([await rec('https://a.com', 1)], a.local);
    const page = await rec('https://b.com', 2);
    await recordAutoRun({ since: 2, tabCount: 1, undo: { saved: [page], previous: [] }, places: {} }, a.local);
    a.local.data.set('unrelated', 1);
    a.session.data.set('activity', { current: null, tabs: {} });

    const snapshot = await deleteAllData(a);
    expect(await listArchive(a.local)).toEqual([]);
    expect(a.local.data.has(AUTO_RUN_KEY)).toBe(false);
    expect(a.session.data.has('activity')).toBe(false);
    expect(a.sync.data.size).toBe(0);
    expect((await loadPreferences(a.prefs)).onboarded).toBe(false);
    expect(a.local.data.get('unrelated')).toBe(1);

    await restoreAllData(snapshot, a);
    expect((await listArchive(a.local)).map((r) => r.url)).toEqual(['https://a.com']);
    expect((await readAutoRun(a.local))?.undo.saved).toEqual([page]);
    const prefs = await loadPreferences(a.prefs);
    expect(prefs.onboarded).toBe(true);
    expect(prefs.topics).toEqual(['mine']);
  });
});
