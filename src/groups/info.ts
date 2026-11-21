/** Chrome tab group basics shared by scoring, archiving and organising. Pure. */

/** Chrome's tab group colours, in its own order. */
export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const MAX_GROUP_TITLE = 60;

export interface GroupInfo {
  title: string;
  color: GroupColor;
}

/** Group id -> name and colour, for the groups open right now. */
export type GroupMap = Map<number, GroupInfo>;

/** No group. Matches chrome.tabGroups.TAB_GROUP_ID_NONE. */
export const NO_GROUP = -1;

export function isGroupColor(v: unknown): v is GroupColor {
  return typeof v === 'string' && (GROUP_COLORS as readonly string[]).includes(v);
}

/** Validates a group read from storage or Chrome. Returns null for unnamed or malformed groups. */
export function sanitizeGroup(v: unknown): GroupInfo | null {
  if (typeof v !== 'object' || v === null) return null;
  const { title, color } = v as Record<string, unknown>;
  if (typeof title !== 'string') return null;
  const clean = title.trim().slice(0, MAX_GROUP_TITLE);
  if (!clean) return null;
  return { title: clean, color: isGroupColor(color) ? color : 'grey' };
}
