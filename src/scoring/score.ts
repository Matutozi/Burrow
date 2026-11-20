import { classify, hostOf, matchesDomain } from '../prefs/classify';
import type { ContentType, Preferences } from '../prefs/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything the scorer needs to know about one tab. */
export interface TabSignals {
  url: string;
  title: string;
  /** Epoch ms the tab was last focused. */
  lastAccessed: number;
  pinned: boolean;
  audible: boolean;
  /** The tab currently focused in its window. */
  active: boolean;
  /** Times the user switched to this tab (filled in by activity tracking, step 2). */
  visitCount?: number;
  /** Total foreground time in ms (filled in by activity tracking, step 2). */
  activeMs?: number;
}

export interface ScoreReason {
  label: string;
  /** Points this reason added or removed. 0 for informational reasons. */
  points: number;
}

export interface TabScore {
  score: number;
  contentType: ContentType;
  /** Protected tabs are never suggested for archiving, whatever their score. */
  protected: boolean;
  reasons: ScoreReason[];
}


export function formatAge(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Topics found as whole words in the title or URL. */
export function matchedTopics(signals: Pick<TabSignals, 'url' | 'title'>, topics: string[]): string[] {
  const haystack = `${signals.title} ${signals.url}`.toLowerCase();
  return topics.filter((t) => {
    const topic = t.trim().toLowerCase();
    if (!topic) return false;
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
  });
}

/**
 * Scores a tab from 0 (clutter) to 100 (keep).
 * score = recency + activity + preference adjustments, clamped to 0-100.
 * Every weight comes from prefs.weights, so users can tune the formula.
 * Pure: same inputs always give the same output.
 */
export function scoreTab(signals: TabSignals, prefs: Preferences, now: number): TabScore {
  const w = prefs.weights;
  const contentType = classify(signals.url, { siteRules: prefs.siteRules, useBuiltIns: prefs.useBuiltInSiteLists });
  const host = hostOf(signals.url);
  const reasons: ScoreReason[] = [];

  if (host && prefs.alwaysImportant.some((d) => matchesDomain(host, d))) {
    return { score: 100, contentType, protected: true, reasons: [{ label: 'always-important site', points: 0 }] };
  }

  // Recency: halves every third of the stale period, so a tab reaches ~12% at the stale point.
  const ageMs = Math.max(0, now - signals.lastAccessed);
  const halfLifeMs = (Math.max(1, prefs.staleAfterDays) * DAY_MS) / 3;
  const recency = signals.active ? w.recencyMax : w.recencyMax * Math.pow(0.5, ageMs / halfLifeMs);
  reasons.push({
    label: signals.active ? 'open right now' : `last opened ${formatAge(ageMs)}`,
    points: Math.round(recency),
  });
  let score = recency;

  const visits = signals.visitCount ?? 0;
  const activeMins = (signals.activeMs ?? 0) / 60000;
  if (visits > 0 || activeMins > 0) {
    const activity = Math.min(w.activityMax, Math.log2(1 + visits) * 3 + Math.min(6, activeMins / 5));
    score += activity;
    reasons.push({ label: `${visits} visit${visits === 1 ? '' : 's'}, ${Math.round(activeMins)}m active`, points: Math.round(activity) });
  }

  const priority = prefs.contentPriority[contentType];
  if (priority !== 'normal') {
    const points = priority === 'high' ? w.priorityPoints : -w.priorityPoints;
    score += points;
    reasons.push({ label: `${contentType} is ${priority} priority for you`, points });
  }

  const topics = matchedTopics(signals, prefs.topics);
  if (topics.length > 0) {
    score += w.topicPoints;
    reasons.push({ label: `matches your topic "${topics[0]}"`, points: w.topicPoints });
  }

  if (host && prefs.lowPriority.some((d) => matchesDomain(host, d))) {
    score -= w.lowPrioritySitePoints;
    reasons.push({ label: 'on your low-priority list', points: -w.lowPrioritySitePoints });
  }

  let isProtected = false;
  if (signals.pinned) {
    isProtected = true;
    reasons.push({ label: 'pinned', points: 0 });
  }
  if (signals.audible) {
    isProtected = true;
    reasons.push({ label: 'playing audio', points: 0 });
  }
  if (signals.active) isProtected = true;

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    contentType,
    protected: isProtected,
    reasons,
  };
}

export function isArchiveCandidate(result: TabScore, prefs: Preferences): boolean {
  return !result.protected && result.score < prefs.archiveThreshold;
}
