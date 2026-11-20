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
