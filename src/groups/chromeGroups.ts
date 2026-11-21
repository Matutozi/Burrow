/**
 * Thin Chrome wrappers for tab groups. Reading or naming groups needs the optional tabGroups
 * permission; without it, everything here quietly does nothing, so callers never break.
 */
import { NO_GROUP, sanitizeGroup, type GroupInfo, type GroupMap } from './info';

export const GROUP_PERMISSION: chrome.permissions.Permissions = { permissions: ['tabGroups'] };

export async function hasGroupAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(GROUP_PERMISSION);
  } catch {
    return false;
  }
}

/** Asks Chrome for tab group access. Must be called from a click, before any other await. Shows no prompt. */
export function requestGroupAccess(): Promise<boolean> {
  return chrome.permissions.request(GROUP_PERMISSION);
}

/** Names and colours of all open groups, or an empty map without permission. */
export async function readGroups(): Promise<GroupMap> {
  const map: GroupMap = new Map();
  if (typeof chrome.tabGroups === 'undefined' || !(await hasGroupAccess())) return map;
  for (const g of await chrome.tabGroups.query({})) {
    const info = sanitizeGroup(g);
    if (info) map.set(g.id, info);
  }
  return map;
}

type TabIds = [number, ...number[]];
const nonEmpty = (ids: number[]): ids is TabIds => ids.length > 0;

async function findGroup(windowId: number, title: string): Promise<number | null> {
  const found = await chrome.tabGroups.query({ windowId, title });
  return found[0]?.id ?? null;
}

/** Adds tabs (all in one window) to the group with this name there, creating it if needed. Returns the group id. */
async function groupInWindow(
  tabIds: TabIds,
  windowId: number,
  group: GroupInfo,
): Promise<{ id: number; created: boolean }> {
  const existing = await findGroup(windowId, group.title);
  if (existing !== null) {
    await chrome.tabs.group({ groupId: existing, tabIds });
    return { id: existing, created: false };
  }
  const id = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(id, { title: group.title, color: group.color });
  return { id, created: true };
}

/** Best effort: puts a reopened tab back into its old group. The tab is already open, so failures are only logged. */
export async function restoreTabGroup(tab: chrome.tabs.Tab, group: GroupInfo | undefined): Promise<void> {
  if (!group || tab.id === undefined || typeof chrome.tabGroups === 'undefined') return;
  try {
    if (!(await hasGroupAccess())) return;
    await groupInWindow([tab.id], tab.windowId, group);
  } catch (err) {
    console.warn('Burrow: could not put the tab back in its group', err);
  }
}

export interface GroupRequest extends GroupInfo {
  tabIds: number[];
}

/** What organising changed, so it can be undone: the tabs it grouped (they were ungrouped before). */
export interface GroupingUndo {
  tabIds: number[];
}

export interface GroupingResult {
  undo: GroupingUndo;
  groupsCreated: number;
  groupsExtended: number;
  /** Tabs that had closed, moved or been grouped meanwhile, and were left alone. */
  skipped: number;
}

/**
 * Creates the confirmed groups. Tabs are re-read first: anything closed, pinned or already put in a
 * group since the preview was made is left alone. Groups are per window, so a group with tabs in
 * several windows becomes one group with that name in each.
 */
export async function applyGroups(requests: GroupRequest[]): Promise<GroupingResult> {
  const grouped: number[] = [];
  let groupsCreated = 0;
  let groupsExtended = 0;
  let skipped = 0;
  for (const req of requests) {
    const tabs = await Promise.all(req.tabIds.map((id) => chrome.tabs.get(id).catch(() => null)));
    const byWindow = new Map<number, number[]>();
    for (const t of tabs) {
      if (!t || t.id === undefined || t.pinned || t.groupId !== NO_GROUP) {
        skipped++;
        continue;
      }
      byWindow.set(t.windowId, [...(byWindow.get(t.windowId) ?? []), t.id]);
    }
    for (const [windowId, ids] of byWindow) {
      if (!nonEmpty(ids)) continue;
      try {
        const { created } = await groupInWindow(ids, windowId, req);
        if (created) groupsCreated++;
        else groupsExtended++;
        grouped.push(...ids);
      } catch (err) {
        console.warn('Burrow: could not create a group', err);
        skipped += ids.length;
      }
    }
  }
  return { undo: { tabIds: grouped }, groupsCreated, groupsExtended, skipped };
}

/** Takes the organised tabs back out of their groups. Groups left empty disappear on their own. */
export async function undoGroups(undo: GroupingUndo): Promise<void> {
  const open = await Promise.all(undo.tabIds.map((id) => chrome.tabs.get(id).catch(() => null)));
  const ids = open.flatMap((t) => (t?.id !== undefined && t.groupId !== NO_GROUP ? [t.id] : []));
  if (nonEmpty(ids)) await chrome.tabs.ungroup(ids);
}
