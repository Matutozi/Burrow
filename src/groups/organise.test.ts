import { describe, expect, it } from 'vitest';
import type { TabScore } from '../scoring/score';
import { NO_GROUP, sanitizeGroup } from './info';
import { addGroup, confirmedGroups, moveTab, planOrganise, updateGroup, type OrganiseTab } from './organise';

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

  it('never touches pinned or already grouped tabs, and leaves "everything else" ungrouped', () => {
    const tabs = [tab('video', { pinned: true }), tab('video', { groupId: 7 }), tab('other'), tab('other')];
    const plan = planOrganise(tabs, 1);
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
