import { describe, expect, it } from 'vitest';
import { EMPTY_ACTIVITY } from '../activity/tracker';
import { ARCHIVE_KEY, archiveGroup, moveTab, planOrganise, type OrganiseTab } from '../groups/organise';
import { defaultPreferences } from '../prefs/defaults';
import { createScorer } from '../scoring/score';
import { suggest } from './omnibox';
import { planArchive } from './plan';
import {
  buildRecord,
  cleanLabel,
  createArchiveSearch,
  hasLabel,
  labelsIn,
  sanitizeRecord,
  type ArchiveRecord,
} from './record';
import { listArchive, putRecords, relabelRecords, type ArchiveArea } from './store';

class FakeArea implements ArchiveArea {
  data = new Map<string, unknown>();
  async get(keys: string[] | null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.data) if (keys === null || keys.includes(k)) out[k] = structuredClone(v);
    return out;
  }
  async set(items: Record<string, unknown>) {
    for (const [k, v] of Object.entries(items)) this.data.set(k, structuredClone(v));
  }
  async remove(keys: string[]) {
    for (const k of keys) this.data.delete(k);
  }
}

async function rec(url: string, label?: string, title = url): Promise<ArchiveRecord> {
  const r = await buildRecord({ url, title, contentType: 'learning', score: 3, label }, 'title', 1);
  if (!r) throw new Error('not archivable');
  return r;
}

describe('"Save under" names', () => {
  it('tidies names and stores them on records', async () => {
    expect(cleanLabel('  My   School  ')).toBe('My School');
    expect(cleanLabel(42)).toBe('');
    expect((await rec('https://a.com', ' School '))?.label).toBe('School');
    expect(await rec('https://a.com', '   ')).not.toHaveProperty('label');
    expect(sanitizeRecord({ url: 'https://a.com', label: 'x'.repeat(99) }, 'id')?.label).toHaveLength(40);
  });

  it('lists names by use, ignoring case, and finds pages by name', async () => {
    const records = [
      await rec('https://a.com', 'School'),
      await rec('https://b.com', 'school'),
      await rec('https://c.com', 'Work'),
      await rec('https://d.com'),
    ];
    expect(labelsIn(records)).toEqual([
      { name: 'School', count: 2 },
      { name: 'Work', count: 1 },
    ]);
    expect(records.filter((r) => hasLabel(r, 'SCHOOL'))).toHaveLength(2);
    expect(createArchiveSearch(records)('school').map((r) => r.url)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('shows the name in address bar suggestions', async () => {
    const r = await rec('https://a.com/x', 'School', 'Lecture 3');
    const [s] = suggest(createArchiveSearch([r]), 'school', 'archived');
    expect(s?.description).toContain('<match>School</match>');
  });

  it('renames pages and can put them back', async () => {
    const area = new FakeArea();
    const before = [await rec('https://a.com', 'Old'), await rec('https://b.com')];
    await putRecords(before, area);
    const previous = await relabelRecords(before, ' Coding practice ', area);
    expect((await listArchive(area)).map((r) => r.label)).toEqual(['Coding practice', 'Coding practice']);
    await relabelRecords(await listArchive(area), '', area);
    expect((await listArchive(area)).every((r) => r.label === undefined)).toBe(true);
    await putRecords(previous, area);
    expect((await listArchive(area)).map((r) => r.label ?? null).sort()).toEqual(['Old', null].sort());
  });

  it('archiving applies one name to all tabs, with per-tab names winning', () => {
    const prefs = defaultPreferences();
    const t = (id: number) =>
      ({
        id,
        index: id,
        windowId: 1,
        url: `https://s${id}.com`,
        title: 't',
        pinned: false,
        active: false,
        incognito: false,
        groupId: -1,
        lastAccessed: 0,
      }) as chrome.tabs.Tab;
    const p = planArchive([t(1), t(2)], {
      scorer: createScorer(prefs),
      prefs,
      activity: EMPTY_ACTIVITY,
      now: 10 * 24 * 3600 * 1000,
      label: 'School',
      labels: new Map([[2, 'Courses']]),
    });
    expect(p.requests.map((r) => r.input.label)).toEqual(['School', 'Courses']);
  });
});

describe('Organise: "Archive group" saves under the group name', () => {
  const tab = (tabId: number): OrganiseTab => ({
    tabId,
    title: 't',
    url: `https://s${tabId}.com`,
    pinned: false,
    groupId: -1,
    clutter: false,
    archivable: true,
    result: {
      score: 50,
      contentType: 'learning',
      category: null,
      group: null,
      indexPolicy: 'title',
      protected: false,
      reasons: [],
    },
  });

  it('names pages after their group, and forgets the name if a tab is moved back', () => {
    const plan = planOrganise([tab(1), tab(2)], 2);
    const done = archiveGroup(plan, 'type:learning');
    expect([...done.archiveLabels]).toEqual([
      [1, 'Courses & learning'],
      [2, 'Courses & learning'],
    ]);
    const back = moveTab(done, 1, 'type:learning');
    expect(back.archiveLabels.has(1)).toBe(false);
    expect(moveTab(back, 1, ARCHIVE_KEY).archiveLabels.has(1)).toBe(false);
  });
});
