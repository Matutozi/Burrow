/**
 * "Organise tabs": proposes Chrome tab groups for the user's ungrouped tabs. Pure, so the whole
 * proposal is unit-tested. Nothing changes until the user has reviewed and confirmed it.
 */
import { CONTENT_TYPE_LABELS, type ContentType } from '../prefs/types';
import type { TabScore } from '../scoring/score';
import { GROUP_COLORS, MAX_GROUP_TITLE, NO_GROUP, type GroupColor } from './info';

export interface OrganiseTab {
  tabId: number;
  title: string;
  url: string;
  pinned: boolean;
  /** Chrome group id, or NO_GROUP. */
  groupId: number;
  result: TabScore;
}

export interface ProposedGroup {
  /** "cat:<id>" for the user's categories, "type:<contentType>" for built-in types, "new:<n>" for ones the user adds. */
  key: string;
  title: string;
  color: GroupColor;
  tabIds: number[];
  /** Unticked groups are not created. */
  include: boolean;
}

export interface OrganisePlan {
  groups: ProposedGroup[];
  /** Tabs Burrow will leave ungrouped. */
  ungrouped: number[];
  /** Tabs left out entirely: pinned (Chrome can't group them) or already in a group. */
  untouched: number;
}

/** Content types that are too broad to make a useful group on their own. */
const NOT_GROUPED: ReadonlySet<ContentType> = new Set(['other']);

/** Colours in the order Burrow hands them out. Grey is last: it's for leftovers. */
const PALETTE: readonly GroupColor[] = [...GROUP_COLORS.filter((c) => c !== 'grey'), 'grey'];

function keyFor(result: TabScore): { key: string; title: string } | null {
  if (result.category) return { key: `cat:${result.category.id}`, title: result.category.name };
  if (NOT_GROUPED.has(result.contentType)) return null;
  return { key: `type:${result.contentType}`, title: CONTENT_TYPE_LABELS[result.contentType] };
}

export function planOrganise(tabs: OrganiseTab[], minTabs: number): OrganisePlan {
  let untouched = 0;
  const buckets = new Map<string, { title: string; tabIds: number[]; mine: boolean }>();
  const ungrouped: number[] = [];

  for (const t of tabs) {
    if (t.pinned || t.groupId !== NO_GROUP) {
      untouched++;
      continue;
    }
    const k = keyFor(t.result);
    if (!k) {
      ungrouped.push(t.tabId);
      continue;
    }
    const b = buckets.get(k.key) ?? { title: k.title, tabIds: [], mine: k.key.startsWith('cat:') };
    b.tabIds.push(t.tabId);
    buckets.set(k.key, b);
  }

  // The user's own categories first, then the biggest groups.
  const sorted = [...buckets].sort(
    ([, a], [, b]) =>
      Number(b.mine) - Number(a.mine) || b.tabIds.length - a.tabIds.length || a.title.localeCompare(b.title),
  );
  const groups: ProposedGroup[] = [];
  for (const [key, b] of sorted) {
    if (b.tabIds.length < Math.max(1, minTabs)) {
      ungrouped.push(...b.tabIds);
      continue;
    }
    groups.push({
      key,
      title: b.title.slice(0, MAX_GROUP_TITLE),
      color: PALETTE[groups.length % PALETTE.length] ?? 'grey',
      tabIds: b.tabIds,
      include: true,
    });
  }
  return { groups, ungrouped, untouched };
}

/** Moves one tab to another group, or to "no group" (null). Returns a new plan. */
export function moveTab(plan: OrganisePlan, tabId: number, toKey: string | null): OrganisePlan {
  const groups = plan.groups.map((g) => ({
    ...g,
    tabIds: g.key === toKey ? [...g.tabIds.filter((id) => id !== tabId), tabId] : g.tabIds.filter((id) => id !== tabId),
  }));
  const ungrouped = plan.ungrouped.filter((id) => id !== tabId);
  if (toKey === null || !groups.some((g) => g.key === toKey)) ungrouped.push(tabId);
  return { ...plan, groups, ungrouped };
}

/** Adds an empty group the user can move tabs into. */
export function addGroup(plan: OrganisePlan, title: string): OrganisePlan {
  const n = plan.groups.filter((g) => g.key.startsWith('new:')).length + 1;
  const color = PALETTE[plan.groups.length % PALETTE.length] ?? 'grey';
  const group: ProposedGroup = {
    key: `new:${n}`,
    title: title.trim().slice(0, MAX_GROUP_TITLE),
    color,
    tabIds: [],
    include: true,
  };
  return { ...plan, groups: [...plan.groups, group] };
}

export function updateGroup(
  plan: OrganisePlan,
  key: string,
  patch: Partial<Pick<ProposedGroup, 'title' | 'color' | 'include'>>,
): OrganisePlan {
  return { ...plan, groups: plan.groups.map((g) => (g.key === key ? { ...g, ...patch } : g)) };
}

/** The groups to create: ticked, named, and not empty. */
export function confirmedGroups(plan: OrganisePlan): { title: string; color: GroupColor; tabIds: number[] }[] {
  return plan.groups
    .filter((g) => g.include && g.tabIds.length > 0 && g.title.trim())
    .map((g) => ({ title: g.title.trim().slice(0, MAX_GROUP_TITLE), color: g.color, tabIds: g.tabIds }));
}
