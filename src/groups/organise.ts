/**
 * "Organise tabs": a cleanup step for the user's ungrouped tabs. Low-score tabs are proposed for
 * archiving (closed, saved, searchable); the tabs worth keeping are proposed as Chrome tab groups.
 * Pure, so the whole proposal is unit-tested. Nothing changes until the user has reviewed and
 * confirmed it.
 */
import { hostOf } from '../prefs/classify';
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
  /** Below the user's archive threshold. */
  clutter: boolean;
  /** May be archived: not protected (active, pinned, audible), a web page, and not "never save". */
  archivable: boolean;
}

/** Pseudo group key for "archive this tab". */
export const ARCHIVE_KEY = '__archive';

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
  /** Tabs to archive: saved, then closed. */
  archive: number[];
  /** Tabs that may be moved to the archive. */
  archivable: ReadonlySet<number>;
  /**
   * Low-score tabs found inside the user's existing groups. They are proposed for the archive; moved
   * anywhere else they simply stay where they are, in their group.
   */
  inGroup: ReadonlySet<number>;
  /** "Save under" names for tabs put away with "Archive group": the group's name. */
  archiveLabels: ReadonlyMap<number, string>;
  /** Tabs Burrow will leave ungrouped. */
  ungrouped: number[];
  /** Tabs left out entirely: pinned (Chrome can't group them) or already in a group. */
  untouched: number;
}

/** Content types that are too broad to make a useful group on their own. */
const NOT_GROUPED: ReadonlySet<ContentType> = new Set(['other']);

/** Colours in the order Burrow hands them out. Grey is last: it's for leftovers. */
const PALETTE: readonly GroupColor[] = [...GROUP_COLORS.filter((c) => c !== 'grey'), 'grey'];

function keyFor(result: TabScore, url: string): { key: string; title: string } | null {
  if (result.category) return { key: `cat:${result.category.id}`, title: result.category.name };
  if (NOT_GROUPED.has(result.contentType)) {
    // "Everything else" is too broad for one group, but several tabs from the same site still belong together.
    const host = hostOf(url);
    return host ? { key: `site:${host}`, title: host } : null;
  }
  return { key: `type:${result.contentType}`, title: CONTENT_TYPE_LABELS[result.contentType] };
}

/**
 * @param archiveAllowed false after the free trial: nothing is proposed for archiving, so the
 *   preview only groups (grouping is always free).
 */
export function planOrganise(tabs: OrganiseTab[], minTabs: number, archiveAllowed = true): OrganisePlan {
  let untouched = 0;
  const buckets = new Map<string, { title: string; tabIds: number[]; mine: boolean }>();
  const ungrouped: number[] = [];
  const archive: number[] = [];
  const archivable = new Set<number>();
  const inGroup = new Set<number>();

  for (const t of tabs) {
    if (t.pinned) {
      untouched++;
      continue;
    }
    if (t.groupId !== NO_GROUP) {
      // Existing groups are the user's own work: never regrouped. Only their clutter is offered for the archive.
      if (archiveAllowed && t.clutter && t.archivable) {
        archivable.add(t.tabId);
        inGroup.add(t.tabId);
        archive.push(t.tabId);
      } else {
        untouched++;
      }
      continue;
    }
    if (archiveAllowed && t.archivable) archivable.add(t.tabId);
    // Clutter goes to the archive, not into a group: organising should leave fewer tabs open, not tidier clutter.
    if (archiveAllowed && t.clutter && t.archivable) {
      archive.push(t.tabId);
      continue;
    }
    const k = keyFor(t.result, t.url);
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
  return { groups, archive, archivable, inGroup, archiveLabels: new Map(), ungrouped, untouched };
}

/** Tabs left exactly as they are: pinned, in a group and kept, or in a group and not clutter. */
export function leftAsIs(plan: OrganisePlan): number {
  return plan.untouched + [...plan.inGroup].filter((id) => !plan.archive.includes(id)).length;
}

/** Where a tab currently sits in the plan: a group key, ARCHIVE_KEY, or null for "no group". */
export function placeOf(plan: OrganisePlan, tabId: number): string | null {
  if (plan.archive.includes(tabId)) return ARCHIVE_KEY;
  return plan.groups.find((g) => g.tabIds.includes(tabId))?.key ?? null;
}

/** Moves one tab to a group, to the archive (ARCHIVE_KEY), or to "no group" (null). Returns a new plan. */
export function moveTab(plan: OrganisePlan, tabId: number, toKey: string | null): OrganisePlan {
  // Protected or sensitive tabs can't be archived; leave them where they are.
  if (toKey === ARCHIVE_KEY && !plan.archivable.has(tabId)) return plan;
  const archiveLabels = new Map(plan.archiveLabels);
  archiveLabels.delete(tabId);
  plan = { ...plan, archiveLabels };
  // A tab from an existing group is either archived or left in its group: it is never regrouped.
  if (plan.inGroup.has(tabId)) {
    const archive = plan.archive.filter((id) => id !== tabId);
    return { ...plan, archive: toKey === ARCHIVE_KEY ? [...archive, tabId] : archive };
  }
  const groups = plan.groups.map((g) => ({
    ...g,
    tabIds: g.key === toKey ? [...g.tabIds.filter((id) => id !== tabId), tabId] : g.tabIds.filter((id) => id !== tabId),
  }));
  const archive = plan.archive.filter((id) => id !== tabId);
  if (toKey === ARCHIVE_KEY) archive.push(tabId);
  const ungrouped = plan.ungrouped.filter((id) => id !== tabId);
  if (toKey !== ARCHIVE_KEY && (toKey === null || !groups.some((g) => g.key === toKey))) ungrouped.push(tabId);
  return { ...plan, groups, archive, ungrouped };
}

/** Puts a whole proposed group away: every archivable tab in it moves to the archive. */
export function archiveGroup(plan: OrganisePlan, key: string): OrganisePlan {
  const group = plan.groups.find((g) => g.key === key);
  const ids = (group?.tabIds ?? []).filter((id) => plan.archivable.has(id));
  const moved = ids.reduce((p, id) => moveTab(p, id, ARCHIVE_KEY), plan);
  // Saved under the group's name, so the whole set can be found again by it.
  const name = group?.title.trim();
  if (!name) return moved;
  const archiveLabels = new Map(moved.archiveLabels);
  for (const id of ids) archiveLabels.set(id, name);
  return { ...moved, archiveLabels };
}

/** How many tabs in a group could be archived. */
export function archivableIn(plan: OrganisePlan, key: string): number {
  return plan.groups.find((g) => g.key === key)?.tabIds.filter((id) => plan.archivable.has(id)).length ?? 0;
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
