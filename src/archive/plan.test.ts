import { describe, expect, it } from 'vitest';
import { EMPTY_ACTIVITY } from '../activity/tracker';
import { defaultPreferences } from '../prefs/defaults';
import type { Preferences } from '../prefs/types';
import { createScorer } from '../scoring/score';
import { mergeAutoRun, sanitizeAutoRun, type AutoArchiveRun } from './autoRun';
import { planArchive } from './plan';
import type { ArchiveRecord } from './record';
import { reconcileUndo } from './store';

const NOW = 1_000_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let nextId = 1;
function tab(over: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  const id = nextId++;
  return {
    id,
    index: id,
    windowId: 1,
    url: `https://site${id}.com/page`,
    title: `Tab ${id}`,
    pinned: false,
    audible: false,
    active: false,
    incognito: false,
    highlighted: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    frozen: false,
    lastAccessed: NOW - 10 * DAY,
    ...over,
  } as chrome.tabs.Tab;
}

function plan(tabs: chrome.tabs.Tab[], prefs: Preferences = defaultPreferences(), auto = false, all = tabs) {
  return planArchive(tabs, { scorer: createScorer(prefs), prefs, activity: EMPTY_ACTIVITY, now: NOW, auto }, all);
}

describe('planArchive', () => {
  it('re-scores and leaves out tabs that are no longer clutter', () => {
    const stale = tab();
    const p = plan([stale, tab({ active: true }), tab({ pinned: true }), tab({ audible: true }), tab({ lastAccessed: NOW })]);
    expect(p.requests.map((r) => r.tabId)).toEqual([stale.id]);
    expect(p.places[stale.url ?? '']).toEqual({ windowId: 1, index: stale.index });
    expect(p.readable).toEqual([stale.id]);
  });

  it('only marks loaded "full" pages as readable', () => {
    const prefs = defaultPreferences();
    prefs.indexPolicy.other = 'title';
    expect(plan([tab()], prefs).readable).toEqual([]);
    expect(plan([tab({ discarded: true })]).readable).toEqual([]);
  });

  it('keeps sensitive pages in manual plans so the user is told why they stayed open', () => {
    const prefs = defaultPreferences();
    prefs.indexPolicy.other = 'never';
    expect(plan([tab()], prefs).requests).toHaveLength(1);
    expect(plan([tab(), tab()], prefs, true).requests).toHaveLength(0);
  });

  describe('automatic mode', () => {
    it('needs the tab untouched for the configured hours', () => {
      const prefs = { ...defaultPreferences(), autoArchiveAfterHours: 48, archiveThreshold: 100 };
      const recent = tab({ lastAccessed: NOW - 24 * HOUR });
      const old = tab({ lastAccessed: NOW - 72 * HOUR });
      const unknown = tab({ lastAccessed: undefined });
      expect(plan([recent, old, unknown, tab()], prefs, true).requests.map((r) => r.tabId)).toEqual(
        expect.arrayContaining([old.id]),
      );
      expect(plan([recent, old, unknown, tab()], prefs, true).requests.map((r) => r.tabId)).not.toContain(recent.id);
      expect(plan([recent, old, unknown, tab()], prefs, true).requests.map((r) => r.tabId)).not.toContain(unknown.id);
    });

    it('never closes the last tab of a window', () => {
      const alone = tab({ windowId: 7 });
      const a = tab({ windowId: 8 });
      const b = tab({ windowId: 8 });
      const ids = plan([alone, a, b], defaultPreferences(), true).requests.map((r) => r.tabId);
      expect(ids).not.toContain(alone.id);
      expect(ids).toHaveLength(1); // one of a/b stays
    });

    it('counts protected tabs as keeping a window open', () => {
      const keep = tab({ windowId: 9, active: true });
      const stale = tab({ windowId: 9 });
      expect(plan([keep, stale], defaultPreferences(), true).requests.map((r) => r.tabId)).toEqual([stale.id]);
    });

    it('caps each run, lowest score first', () => {
      const prefs = { ...defaultPreferences(), autoArchiveMaxPerRun: 2, lowPriority: ['bad.com'] };
      // Ordinary tabs from 3 days ago score ~9; the low-priority ones score 0.
      const recent = { lastAccessed: NOW - 3 * DAY };
      const tabs = [tab(recent), tab({ url: 'https://bad.com/1' }), tab(recent), tab({ url: 'https://bad.com/2' }), tab(recent)];
      const urls = plan(tabs, prefs, true).requests.map((r) => r.input.url);
      expect(urls.sort()).toEqual(['https://bad.com/1', 'https://bad.com/2']);
    });

    it('skips browser pages instead of counting them against the cap', () => {
      const prefs = { ...defaultPreferences(), autoArchiveMaxPerRun: 1 };
      const p = plan([tab({ url: 'chrome://newtab/' }), tab(), tab()], prefs, true);
      expect(p.requests).toHaveLength(1);
      expect(p.requests[0]?.input.url).toMatch(/^https:/);
    });
  });
});

const rec = (id: string, archivedAt: number, title = id): ArchiveRecord => ({
  v: 2,
  id,
  url: `https://${id}.com`,
  title,
  contentType: 'other',
  score: 5,
  archivedAt,
  saved: 'title',
});

describe('reconcileUndo', () => {
  it('only undoes pages still archived exactly as the run left them', () => {
    const undo = { saved: [rec('a', 2), rec('b', 2), rec('c', 2)], previous: [rec('a', 1, 'old a'), rec('b', 1)] };
    const current = [rec('a', 2), rec('b', 5)]; // b re-archived later, c reopened or deleted
    expect(reconcileUndo(undo, current)).toEqual({ saved: [rec('a', 2)], previous: [rec('a', 1, 'old a')] });
  });
});

describe('automatic run record', () => {
  const run = (saved: ArchiveRecord[], previous: ArchiveRecord[], since: number): AutoArchiveRun => ({
    since,
    tabCount: saved.length,
    undo: { saved, previous },
    places: Object.fromEntries(saved.map((r, i) => [r.url, { windowId: 1, index: i }])),
  });

  it('merges runs, keeping the first run time and the earliest earlier copy', () => {
    const first = run([rec('a', 10)], [rec('a', 1, 'original')], 10);
    const second = run([rec('a', 20), rec('b', 20)], [rec('a', 10), rec('b', 3)], 20);
    const merged = mergeAutoRun(first, second);
    expect(merged.since).toBe(10);
    expect(merged.tabCount).toBe(3);
    expect(merged.undo.saved).toEqual([rec('a', 20), rec('b', 20)]);
    expect(merged.undo.previous).toEqual([rec('a', 1, 'original'), rec('b', 3)]);
  });

  it('sanitizes stored runs and drops empty or corrupt ones', () => {
    expect(sanitizeAutoRun(null)).toBeNull();
    expect(sanitizeAutoRun({ undo: { saved: [] } })).toBeNull();
    const clean = sanitizeAutoRun({
      since: 'x',
      tabCount: -3,
      undo: { saved: [rec('a', 1), { id: 'bad', url: 'javascript:1' }], previous: [rec('zzz', 1)] },
      places: { 'https://a.com': { windowId: 1, index: -2 }, 'https://b.com': { windowId: 'x', index: 0 } },
    });
    expect(clean).toEqual({
      since: 0,
      tabCount: 1,
      undo: { saved: [rec('a', 1)], previous: [] },
      places: { 'https://a.com': { windowId: 1, index: 0 } },
    });
  });
});
