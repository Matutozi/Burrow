import { describe, expect, it } from 'vitest';
import type { TabScore } from '../scoring/score';
import { NO_GROUP, sanitizeGroup } from './info';
import {
  addGroup,
  ARCHIVE_KEY,
  archivableIn,
  archiveGroup,
  confirmedGroups,
  moveTab,
  leftAsIs,
  placeOf,
  planOrganise,
  updateGroup,
  type OrganiseTab,
} from './organise';

let next = 1;
function tab(
  contentType: TabScore['contentType'],
  over: Partial<OrganiseTab> = {},
  category?: { id: string; name: string },
): OrganiseTab {
  const tabId = next++;
  return {
    tabId,
    title: `Tab ${tabId}`,
    url: `https://s${tabId}.com`,
    pinned: false,
    groupId: NO_GROUP,
    result: {
      score: 10,
      contentType,
      category: category ?? null,
      group: null,
      indexPolicy: 'title',
      protected: false,
      reasons: [],
    },
    clutter: false,
    archivable: true,
    ...over,
  };
}

const courses = { id: 'courses', name: 'Courses' };

describe('planOrganise', () => {
  it('groups by your categories first, then by built-in type, biggest first', () => {
    const tabs = [
      tab('video'),
      tab('docs'),
      tab('video'),
      tab('docs', {}, courses),
      tab('docs', {}, courses),
      tab('video'),
    ];
    const plan = planOrganise(tabs, 2);
    expect(plan.groups.map((g) => [g.title, g.tabIds.length])).toEqual([
      ['Courses', 2],
      ['Videos', 3],
    ]);
    // A single docs tab is below the minimum and stays ungrouped.
    expect(plan.ungrouped).toEqual([tabs[1]?.tabId]);
    expect(new Set(plan.groups.map((g) => g.color)).size).toBe(2);
  });

  it('never touches pinned or already grouped tabs, and leaves lone "everything else" tabs ungrouped', () => {
    const tabs = [tab('video', { pinned: true }), tab('video', { groupId: 7 }), tab('other'), tab('other')];
    const plan = planOrganise(tabs, 2);
    expect(plan.groups).toEqual([]);
    expect(plan.untouched).toBe(2);
    expect(plan.ungrouped).toHaveLength(2);
  });

  it('handles 120 tabs quickly', () => {
    const types = ['docs', 'video', 'social', 'news', 'code', 'other'] as const;
    const tabs = Array.from({ length: 120 }, (_, i) => tab(types[i % types.length] ?? 'other'));
    const start = performance.now();
    const plan = planOrganise(tabs, 2);
    expect(performance.now() - start).toBeLessThan(20);
    expect(plan.groups).toHaveLength(5);
    expect(plan.groups.reduce((n, g) => n + g.tabIds.length, 0) + plan.ungrouped.length).toBe(120);
  });
});

describe('editing a proposal', () => {
  const base = () => {
    const tabs = [tab('video'), tab('video'), tab('docs'), tab('docs')];
    return { tabs, plan: planOrganise(tabs, 2) };
  };

  it('moves tabs between groups and out of groups', () => {
    const { tabs, plan } = base();
    const videoId = tabs[0]?.tabId ?? -1;
    const docsKey = 'type:docs';
    const moved = moveTab(plan, videoId, docsKey);
    expect(moved.groups.find((g) => g.key === docsKey)?.tabIds).toContain(videoId);
    expect(moved.groups.find((g) => g.key === 'type:video')?.tabIds).not.toContain(videoId);
    const out = moveTab(moved, videoId, null);
    expect(out.ungrouped).toContain(videoId);
    expect(out.groups.flatMap((g) => g.tabIds)).not.toContain(videoId);
  });

  it('adds, renames and skips groups; only ticked, named, non-empty groups are created', () => {
    const { tabs, plan } = base();
    let p = addGroup(plan, ' Thesis ');
    p = moveTab(p, tabs[2]?.tabId ?? -1, 'new:1');
    p = updateGroup(p, 'type:video', { include: false });
    p = updateGroup(p, 'type:docs', { title: 'Reading', color: 'green' });
    expect(confirmedGroups(p)).toEqual([
      { title: 'Reading', color: 'green', tabIds: [tabs[3]?.tabId] },
      { title: 'Thesis', color: expect.any(String), tabIds: [tabs[2]?.tabId] },
    ]);
    expect(confirmedGroups(updateGroup(p, 'new:1', { title: '  ' })).map((g) => g.title)).toEqual(['Reading']);
  });
});

describe('sanitizeGroup', () => {
  it('requires a name and repairs the colour', () => {
    expect(sanitizeGroup({ title: ' Courses ', color: 'blue' })).toEqual({ title: 'Courses', color: 'blue' });
    expect(sanitizeGroup({ title: 'x', color: 'neon' })).toEqual({ title: 'x', color: 'grey' });
    expect(sanitizeGroup({ title: '  ' })).toBeNull();
    expect(sanitizeGroup(null)).toBeNull();
  });
});

describe('cleanup: archive the clutter, group the keepers', () => {
  it('proposes low-score tabs for the archive instead of a group', () => {
    const keep = [tab('video'), tab('video')];
    const clutter = [tab('video', { clutter: true }), tab('news', { clutter: true })];
    const plan = planOrganise([...keep, ...clutter], 2);
    expect(plan.archive).toEqual(clutter.map((t) => t.tabId));
    expect(plan.groups.map((g) => [g.title, g.tabIds])).toEqual([['Videos', keep.map((t) => t.tabId)]]);
    expect(placeOf(plan, clutter[0]?.tabId ?? -1)).toBe(ARCHIVE_KEY);
  });

  it('keeps clutter that cannot be archived (sensitive or protected) out of the archive', () => {
    const sensitive = tab('email', { clutter: true, archivable: false });
    const plan = planOrganise([sensitive, tab('email', { clutter: true, archivable: false })], 2);
    expect(plan.archive).toEqual([]);
    expect(plan.groups[0]?.tabIds).toContain(sensitive.tabId);
    expect(moveTab(plan, sensitive.tabId, ARCHIVE_KEY)).toBe(plan);
  });

  it('proposes no archiving after the trial, only groups', () => {
    const plan = planOrganise([tab('video', { clutter: true }), tab('video', { clutter: true })], 2, false);
    expect(plan.archive).toEqual([]);
    expect(plan.groups[0]?.tabIds).toHaveLength(2);
    expect(plan.archivable.size).toBe(0);
  });

  it('moves tabs into and out of the archive', () => {
    const t1 = tab('video', { clutter: true });
    const plan = planOrganise([t1, tab('video'), tab('video')], 2);
    const kept = moveTab(plan, t1.tabId, 'type:video');
    expect(kept.archive).toEqual([]);
    expect(placeOf(kept, t1.tabId)).toBe('type:video');
    const back = moveTab(kept, t1.tabId, ARCHIVE_KEY);
    expect(back.archive).toEqual([t1.tabId]);
    expect(back.groups[0]?.tabIds).not.toContain(t1.tabId);
    expect(placeOf(moveTab(back, t1.tabId, null), t1.tabId)).toBeNull();
  });

  it('archives a whole group except tabs that cannot be archived', () => {
    const a = tab('docs', {}, courses);
    const b = tab('docs', {}, courses);
    const locked = tab('docs', { archivable: false }, courses);
    const plan = planOrganise([a, b, locked], 2);
    expect(archivableIn(plan, 'cat:courses')).toBe(2);
    const done = archiveGroup(plan, 'cat:courses');
    expect(done.archive).toEqual([a.tabId, b.tabId]);
    expect(done.groups[0]?.tabIds).toEqual([locked.tabId]);
  });
});

describe('fixes from real use', () => {
  it('offers clutter inside existing groups for the archive, and keeps it in its group if moved back', () => {
    const grouped = tab('video', { groupId: 5, clutter: true });
    const fine = tab('video', { groupId: 5 });
    const plan = planOrganise([grouped, fine], 2);
    expect(plan.archive).toEqual([grouped.tabId]);
    expect(leftAsIs(plan)).toBe(1);
    expect(plan.groups).toEqual([]);
    const kept = moveTab(plan, grouped.tabId, 'type:video');
    expect(kept.archive).toEqual([]);
    expect(kept.ungrouped).toEqual([]);
    expect(leftAsIs(kept)).toBe(2);
    expect(placeOf(kept, grouped.tabId)).toBeNull();
  });

  it('groups "everything else" tabs by site when there are enough of them', () => {
    const a = tab('other', { url: 'https://o2tv.com/a' });
    const b = tab('other', { url: 'https://www.o2tv.com/b' });
    const lone = tab('other', { url: 'https://paulgraham.com' });
    const plan = planOrganise([a, b, lone], 2);
    expect(plan.groups.map((g) => [g.key, g.title, g.tabIds])).toEqual([
      ['site:o2tv.com', 'o2tv.com', [a.tabId, b.tabId]],
    ]);
    expect(plan.ungrouped).toEqual([lone.tabId]);
  });
});
