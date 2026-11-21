import { CONTENT_TYPE_LABELS } from '../prefs/types';
import type { ScoreReason } from '../scoring/score';

/** All user-facing wording for score reasons lives here, ready for translation. */

export function formatAge(ms: number): string {
  const mins = Math.floor(Math.max(0, ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function reasonLabel(r: ScoreReason): string {
  switch (r.code) {
    case 'alwaysImportant':
      return 'always-important site';
    case 'activeNow':
      return 'open right now';
    case 'lastOpened':
      return `last opened ${formatAge(r.ageMs)}`;
    case 'activity': {
      const mins = Math.round(r.activeMs / 60000);
      return `${r.visits} visit${r.visits === 1 ? '' : 's'}, ${mins}m active`;
    }
    case 'priority':
      return `${CONTENT_TYPE_LABELS[r.contentType].toLowerCase()}: ${r.priority} priority`;
    case 'category':
      return `${r.name}: ${r.priority} priority`;
    case 'topic':
      return `matches "${r.topic}"`;
    case 'lowPrioritySite':
      return 'low-priority site';
    case 'pinned':
      return 'pinned';
    case 'audible':
      return 'playing audio';
  }
}

export function formatReason(r: ScoreReason): string {
  const label = reasonLabel(r);
  if (!r.points) return label;
  return `${label} (${r.points > 0 ? '+' : ''}${r.points})`;
}

export function formatReasons(reasons: ScoreReason[]): string {
  return reasons.map(formatReason).join(' · ');
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Toast after archiving. */
export function formatArchiveResult(
  archived: number,
  closeFailed: number,
  sensitive: number,
  notWebPage: number,
  textDropped = false,
  label = '',
): string {
  const parts: string[] = [];
  if (archived > 0)
    parts.push(label ? `Archived ${plural(archived, 'tab')} under "${label}"` : `Archived ${plural(archived, 'tab')}`);
  if (closeFailed > 0)
    parts.push(`${plural(closeFailed, 'tab')} couldn't be closed but ${closeFailed === 1 ? 'is' : 'are'} saved`);
  if (sensitive > 0) parts.push(`${plural(sensitive, 'sensitive tab')} left open (set to "never save")`);
  if (notWebPage > 0) parts.push(`${plural(notWebPage, 'browser page')} left open`);
  if (textDropped) parts.push('storage is full, so only titles were saved');
  return parts.length > 0 ? parts.join(' · ') : 'Nothing to archive';
}

export const ARCHIVE_TEXT = {
  archive: 'Archive',
  archiveAll: (n: number) => `Archive all ${n}`,
  sensitive: 'not saved: sensitive',
  saveFailed: 'Could not save to the archive, so no tabs were closed. Try again.',
  undo: 'Undo',
  undone: 'Undone. Tabs reopened.',
  undoFailed: 'Could not reopen the tabs. They are still in your archive.',
  restored: (n: number) => `Reopened ${plural(n, 'page')}`,
  restoreFailed: 'Could not reopen. The page is still in your archive.',
  deleted: (n: number) => `Deleted ${plural(n, 'page')} from the archive`,
  deleteFailed: 'Could not delete. Try again.',
  confirmDeleteAll: (n: number) => `Delete all ${plural(n, 'archived page')}? You can undo this right after.`,
  exportFailed: 'Could not export your data.',
  count: (n: number) => plural(n, 'archived page'),
  empty: 'Nothing archived yet. Tabs you archive appear here, ready to reopen.',
  noMatches: 'No archived pages match.',
  fullText: 'full text',
  captureLabel: 'Read pages when I put them away (search inside "Full text" pages, and spot deadlines)',
  captureHelp:
    'Chrome will ask to let Burrow read pages. Burrow reads a page only when you archive it, never sends it anywhere, and skips pages with a password box. For pages not set to "Full text", only a deadline date is kept, never the text.',
  captureDenied: 'Page access was not granted, so Burrow saves titles only.',
  captureMissing: 'Page access was removed in Chrome settings. Turn this on again to save page text.',
};

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Address-bar search. Chrome renders these as XML: %s is the user's text, already escaped by Chrome. */
export const OMNIBOX_TEXT = {
  defaultSuggestion: 'Search your Burrow archive for <match>%s</match>',
  label: 'archived',
};

export const DATA_TEXT = {
  importButton: 'Import from file',
  privacyPolicy: 'Privacy policy',
  deleteEverything: 'Delete all Burrow data',
  confirmDeleteEverything:
    'Delete all Burrow data on this device and in Chrome sync: preferences, archived pages and activity? You can undo this right after.',
  deletedEverything: 'All Burrow data deleted.',
  restoredEverything: 'Your data is back.',
  deleteEverythingFailed: 'Could not delete everything. Some data may remain; try again.',
  restoreFailed: 'Could not restore your data. Import your last export file to recover it.',
  confirmImportPrefs: 'This file also has preferences. Replace your current preferences with them?',
  imported: (n: number, unchanged: number) =>
    `Imported ${plural(n, 'page')}${unchanged > 0 ? ` (${unchanged} already up to date)` : ''}`,
  importedPrefs: 'preferences replaced',
  importUndone: 'Import undone.',
  importErrors: {
    tooLarge: 'That file is too large to be a Burrow export.',
    notJson: 'That file is not valid JSON.',
    notBurrow: 'That file is not a Burrow export.',
  } as Record<'tooLarge' | 'notJson' | 'notBurrow', string>,
  importFailed: 'Could not import that file. Nothing was changed.',
  undoFailed: 'Could not undo. Try again.',
};

export const AUTO_TEXT = {
  denied: 'Chrome did not allow scheduling, so Burrow will keep asking first.',
  missing: 'Scheduling permission was removed in Chrome settings. Choose "Archive automatically" again to restore it.',
  safety:
    'Burrow never automatically archives pinned, audible or open-in-front tabs, sensitive pages, or the last tab in a window. Every automatic cleanup can be undone from the tab list.',
  banner: (n: number, since: number) =>
    `Archived in the background (shortcut or automatic cleanup): ${plural(n, 'tab')} since ${new Date(since).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`,
  undone: (n: number) => (n > 0 ? `Reopened ${plural(n, 'tab')}` : 'Those pages were already reopened or deleted.'),
  undoFailed: 'Could not reopen the tabs. They are still in your archive.',
  dismiss: 'Dismiss',
};

export const LICENSE_TEXT = {
  chipTrial: (days: number) => `Trial: ${plural(days, 'day')} left`,
  chipExpired: 'Unlock Burrow',
  title: 'Burrow license',
  trial: (days: number, endsAt: number) =>
    `Free trial: ${plural(days, 'day')} left (until ${formatDate(endsAt)}). Everything works during the trial.`,
  expired: (endedAt: number) =>
    `Your free trial ended on ${formatDate(endedAt)}. Organise, automatic cleanup, page-text saving and deadline reminders are paused until you enter a license key.`,
  alwaysFree:
    'Always free: putting tabs away (one by one, all at once, "Archive this tab" and the shortcut), Save under names, reopening and searching everything you saved (including from the address bar), export, import and delete.',
  paid: 'With a license: Organise (clean up 100+ tabs with a preview), automatic cleanup, saving page text to search inside pages, and deadline reminders.',
  licensed: (id: string, issuedAt: number) =>
    `Licensed (${id}, issued ${formatDate(issuedAt)}). Thank you for supporting Burrow!`,
  buy: 'Buy a license',
  keyLabel: 'License key',
  keyPlaceholder: 'BRW1-…',
  activate: 'Activate',
  activated: 'License activated. Thank you!',
  invalid: "That key isn't valid. Check you copied all of it, including BRW1- at the start.",
  saveFailed: 'Could not save the license. Try again.',
  remove: 'Remove license from this browser',
  confirmRemove: 'Remove the license key from this browser profile? You can undo this right after.',
  removed: 'License removed.',
  restored: 'License restored.',
  offline: 'Keys are checked on this device. Burrow never contacts a server to verify them.',
  back: 'Back',
};

export const GROUP_TEXT = {
  organiseButton: 'Organise',
  title: 'Organise tabs',
  summary: (total: number, keep: number, archive: number) =>
    `${plural(total, 'tab')} looked at: keep ${keep} (grouped where it helps), archive ${archive}.`,
  intro:
    'Nothing changes until you confirm. Move any tab with the menu beside it, rename or recolour groups, untick a group to skip it, or put a whole group away.',
  keepHeading: (n: number) => `Keep (${n})`,
  archiveHeading: (n: number) => `Archive (${n} low-score ${n === 1 ? 'tab' : 'tabs'})`,
  archiveHelp:
    'Saved and searchable, then closed to free memory. Reopen them any time from the Archive or the address bar.',
  archiveEmpty: 'Nothing proposed for archiving. Move tabs here with the menu beside them.',
  archiveOption: 'Archive',
  keepInGroup: 'Keep in its group',
  archiveGroup: (n: number) => `Archive group (${n})`,
  leftAsIs: (n: number) =>
    `${plural(n, 'tab')} left as ${n === 1 ? 'it is' : 'they are'} (pinned or already in a group).`,
  confirmBoth: (grouped: number, archived: number) =>
    [grouped > 0 ? `Group ${grouped}` : '', archived > 0 ? `Archive ${archived}` : ''].filter(Boolean).join(' · ') ||
    'Nothing to do',
  working: 'Working…',
  doneBoth: (archived: number, keptOpen: number, created: number, extended: number, skipped: number) =>
    [
      archived > 0 ? `Archived ${plural(archived, 'tab')}` : '',
      keptOpen > 0 ? `${plural(keptOpen, 'tab')} could not be archived and stayed open` : '',
      created > 0 ? `created ${plural(created, 'group')}` : '',
      extended > 0 ? `added to ${plural(extended, 'existing group')}` : '',
      skipped > 0 ? `${plural(skipped, 'tab')} had changed and ${skipped === 1 ? 'was' : 'were'} left alone` : '',
    ]
      .filter(Boolean)
      .join(' · ') || 'Nothing changed',
  noGroup: 'No group',
  ungroupedHeading: (n: number) => `Keep, no group (${n})`,
  groupName: 'Group name',
  colour: 'Colour',
  include: 'Create this group',
  moveTo: 'Move to',
  addGroup: '+ New group',
  newGroupName: 'New group',
  cancel: 'Cancel',
  needAccess:
    'Burrow needs permission to create and name tab groups. Chrome grants it without a prompt; click Organise again.',
  undone: 'Groups undone.',
  failed: 'Could not create the groups. Nothing was changed.',
  useGroupsLabel: 'Use my Chrome tab groups',
  useGroupsHelp:
    'A tab in a group named like one of your categories (for example "Courses") belongs to it, and archived tabs go back into their group when reopened. Chrome grants this without a prompt.',
  useGroupsDenied: 'Chrome did not allow access to tab groups.',
  colours: {
    grey: 'Grey',
    blue: 'Blue',
    red: 'Red',
    yellow: 'Yellow',
    green: 'Green',
    pink: 'Pink',
    purple: 'Purple',
    cyan: 'Cyan',
    orange: 'Orange',
  } as Record<string, string>,
};

export const LABEL_TEXT = {
  saveUnder: 'Save under',
  placeholder: 'optional, e.g. School',
  hint: 'Find them later by typing this name in the Archive search or after "burrow" in the address bar.',
  all: 'All',
  unlabelled: 'No name',
  relabel: (n: number) => `Save ${n === 1 ? 'this page' : `these ${n} pages`} under`,
  relabelButton: 'Save',
  relabelled: (n: number, label: string) =>
    label ? `Saved ${plural(n, 'page')} under "${label}"` : `Removed the name from ${plural(n, 'page')}`,
  relabelFailed: 'Could not save the name. Try again.',
  undone: 'Name change undone.',
};

export const CURRENT_TEXT = {
  heading: 'This tab',
  button: 'Archive this tab',
  shortcut: 'Tip: press Alt+Shift+A on any tab to archive it without opening Burrow.',
  shortcutDone: 'Burrow: tab archived. Open Burrow to undo.',
  archived: (title: string, label: string) =>
    label ? `Archived "${title.slice(0, 60)}" under "${label}"` : `Archived "${title.slice(0, 60)}"`,
  blocked: {
    pinned: 'Pinned: unpin it to archive',
    sensitive: 'Set to "never save"',
    notWebPage: "Browser pages can't be archived",
  } as Record<'pinned' | 'sensitive' | 'notWebPage', string>,
  notArchived: {
    pinned: 'Pinned tabs are not archived. Unpin it first.',
    sensitive: 'This kind of page is set to "never save", so it stays open.',
    notWebPage: "Browser pages can't be archived.",
    gone: 'That tab was already closed.',
  } as Record<'pinned' | 'sensitive' | 'notWebPage' | 'gone', string>,
};

/** Plain words instead of scores. */
export const VERDICT_TEXT = {
  putAway: 'Put away',
  notSure: 'Not sure',
  keep: 'Keep',
  scoreTitle: (score: number) => `score ${score}`,
  putAwayHeading: (n: number) => `Put away (${n})`,
  notSureHeading: (n: number) => `Not sure (${n})`,
  notSureHelp: 'Not used much lately. Put any of them away with its Archive button, or leave them for now.',
  keepHeading: (n: number) => `Keep (${n})`,
};

export const WELCOME_TEXT = {
  hello: 'Welcome to Burrow. Put finished tabs away without losing them: everything stays searchable, and nothing leaves this computer.',
  status: (total: number, finished: number) =>
    finished > 0
      ? `You have ${plural(total, 'open tab')}. ${finished} look finished.`
      : `You have ${plural(total, 'open tab')}. Nothing looks finished right now.`,
  preview: 'Put them away… (preview first)',
  putAwayAll: (n: number) => `Put all ${n} away now`,
  optional: 'Works out of the box. Want it tuned to how you work?',
  personalise: 'Personalise (2 min)',
  dismiss: 'Not now',
  saveFailed: 'Could not save. Try again.',
};

export const FIND_TEXT = {
  label: 'Find anything you put away',
  placeholder: (n: number) => (n > 0 ? `Find anything you put away (${n} saved)…` : 'Find anything you put away…'),
  chipsLabel: 'Your saved names',
  count: (n: number) => (n === 0 ? 'Nothing found.' : `${plural(n, 'page')} found. Click to open; it stays saved.`),
  openArchive: 'Open the full archive',
  openFailed: 'Could not open that page.',
  pageTextTip: 'Only titles and addresses are searched. Want to search inside pages and spot deadlines too?',
  pageTextButton: 'Turn on reading pages',
  pageTextOn: 'Done. Pages you put away from now on can be searched by what they say.',
  pageTextDenied: 'Chrome did not allow reading pages, so Burrow keeps searching titles and addresses.',
};

export function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${Math.round(mb)} MB`;
}

export const GAINS_TEXT = {
  line: (tabs: number, since: string, mb: number) =>
    `Burrow has put away ${plural(tabs, 'tab')} since ${since} · about ${formatMemory(mb)} of memory freed.`,
};

export const DEADLINE_TEXT = {
  heading: (n: number) => `Closing soon (${n})`,
  inDays: (d: number) => (d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`),
  closes: (date: string) => `Closes ${date}`,
  closed: (date: string) => `Closed ${date}`,
  locked: (n: number) => `${plural(n, 'saved page')} ${n === 1 ? 'has a deadline' : 'have deadlines'} coming up.`,
  unlock: 'Unlock reminders',
  openFailed: 'Could not open that page.',
  settingLabel: 'Remind me about deadlines on pages I put away',
  daysLabel: 'Days before the deadline',
};
