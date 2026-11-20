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
export function formatArchiveResult(archived: number, closeFailed: number, sensitive: number, notWebPage: number): string {
  const parts: string[] = [];
  if (archived > 0) parts.push(`Archived ${plural(archived, 'tab')}`);
  if (closeFailed > 0) parts.push(`${plural(closeFailed, 'tab')} couldn't be closed but ${closeFailed === 1 ? 'is' : 'are'} saved`);
  if (sensitive > 0) parts.push(`${plural(sensitive, 'sensitive tab')} left open (set to "never save")`);
  if (notWebPage > 0) parts.push(`${plural(notWebPage, 'browser page')} left open`);
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
};

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
