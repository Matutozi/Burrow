import { createClassifier, hostOf, matchesDomain } from '../prefs/classify';
import type { ContentType, CustomCategory, IndexPolicy, Preferences } from '../prefs/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

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
  /** Times the user switched to this tab. */
  visitCount?: number;
  /** Total foreground time in ms. */
  activeMs?: number;
  /** Name of the Chrome tab group the tab is in, when tab group support is on. */
  groupTitle?: string;
}

/**
 * Why a tab got its score. Structured (not prose) so the UI can word and translate it,
 * and so future features can react to specific reasons.
 */
export type ScoreReason =
  | { code: 'alwaysImportant'; points: 0 }
  | { code: 'activeNow'; points: number }
  | { code: 'lastOpened'; points: number; ageMs: number }
  | { code: 'activity'; points: number; visits: number; activeMs: number }
  | { code: 'priority'; points: number; contentType: ContentType; priority: 'high' | 'low' }
  | { code: 'category'; points: number; name: string; priority: 'high' | 'low' }
  | { code: 'topic'; points: number; topic: string }
  | { code: 'lowPrioritySite'; points: number }
  | { code: 'pinned'; points: 0 }
  | { code: 'audible'; points: 0 };

export interface TabScore {
  score: number;
  contentType: ContentType;
  /** The user's own category this tab belongs to, if any. It overrides the content type's priority and save policy. */
  category: { id: string; name: string } | null;
  /** The tab's Chrome group name, when tab group support is on and the tab is in a named group. */
  group: string | null;
  /** What may be saved when this tab is archived: from its category if it has one, else its content type. */
  indexPolicy: IndexPolicy;
  /** Protected tabs are never suggested for archiving, whatever their score. */
  protected: boolean;
  reasons: ScoreReason[];
}

export interface Scorer {
  score(signals: TabSignals, now: number): TabScore;
  isArchiveCandidate(result: TabScore): boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compiles all topics into one regex. Returns the first topic found as a whole word, or null. */
export function createTopicMatcher(topics: string[]): (text: string) => string | null {
  const cleaned = [...new Set(topics.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length === 0) return () => null;
  // Longest first so "machine learning" wins over "machine" when both are topics.
  cleaned.sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?:^|[^a-z0-9])(${cleaned.map(escapeRegExp).join('|')})(?=$|[^a-z0-9])`);
  return (text) => re.exec(text.toLowerCase())?.[1] ?? null;
}

/**
 * Compiles the user's categories once. Returns the first category whose sites include the host or
 * whose keywords appear in the title or address.
 */
export function createCategoryMatcher(categories: CustomCategory[]): (host: string | null, text: string) => CustomCategory | null {
  if (categories.length === 0) return () => null;
  const compiled = categories.map((c) => ({ c, inSite: domainMatcher(c.domains), mentions: createTopicMatcher(c.keywords) }));
  return (host, text) => compiled.find(({ inSite, mentions }) => inSite(host) || mentions(text) !== null)?.c ?? null;
}

function domainMatcher(domains: string[]): (host: string | null) => boolean {
  if (domains.length === 0) return () => false;
  return (host) => host !== null && domains.some((d) => matchesDomain(host, d));
}

/**
 * Builds a scorer once per preference change. Scores range from 0 (clutter) to 100 (keep):
 *   recency + activity + content priority + topic match - low-priority site, clamped to 0-100.
 * Every number comes from prefs, so users can tune the whole formula. score() is pure.
 */
export function createScorer(prefs: Preferences): Scorer {
  const w = prefs.weights;
  const classify = createClassifier({ siteRules: prefs.siteRules, useBuiltIns: prefs.useBuiltInSiteLists });
  const matchTopic = createTopicMatcher(prefs.topics);
  const matchCategory = createCategoryMatcher(prefs.customCategories);
  const categoryByName = new Map(prefs.customCategories.map((c) => [c.name.toLowerCase(), c]));
  const isImportant = domainMatcher(prefs.alwaysImportant);
  const isLowPriority = domainMatcher(prefs.lowPriority);
  // Recency halves every third of the stale period, so a tab is at ~12% of max when it goes stale.
  const halfLifeMs = (prefs.staleAfterDays * DAY_MS) / 3;
  const fullVisitsLog = Math.log2(1 + Math.max(1, w.activityFullVisits));
  const fullActiveMs = Math.max(1, w.activityFullMinutes) * MINUTE_MS;

  function score(signals: TabSignals, now: number): TabScore {
    const contentType = classify(signals.url, signals.title);
    const host = hostOf(signals.url);
    const text = `${signals.title} ${signals.url}`;
    const group = prefs.useTabGroups ? signals.groupTitle?.trim() || null : null;
    // Putting a tab in a group named like a category is the clearest signal, so it is checked first.
    const cat = (group ? categoryByName.get(group.toLowerCase()) : undefined) ?? matchCategory(host, text);
    const category = cat ? { id: cat.id, name: cat.name } : null;
    const indexPolicy = cat ? cat.indexPolicy : prefs.indexPolicy[contentType];
    if (isImportant(host)) {
      return {
        score: 100,
        contentType,
        category,
        group,
        indexPolicy,
        protected: true,
        reasons: [{ code: 'alwaysImportant', points: 0 }],
      };
    }

    const reasons: ScoreReason[] = [];
    let total = 0;

    if (signals.active) {
      total += w.recencyMax;
      reasons.push({ code: 'activeNow', points: Math.round(w.recencyMax) });
    } else {
      const ageMs = Math.max(0, now - signals.lastAccessed);
      const recency = w.recencyMax * Math.pow(0.5, ageMs / halfLifeMs);
      total += recency;
      reasons.push({ code: 'lastOpened', points: Math.round(recency), ageMs });
    }

    const visits = Math.max(0, signals.visitCount ?? 0);
    const activeMs = Math.max(0, signals.activeMs ?? 0);
    if (visits > 0 || activeMs > 0) {
      const visitShare = Math.min(1, Math.log2(1 + visits) / fullVisitsLog);
      const timeShare = Math.min(1, activeMs / fullActiveMs);
      const activity = w.activityMax * (visitShare + timeShare) / 2;
      total += activity;
      reasons.push({ code: 'activity', points: Math.round(activity), visits, activeMs });
    }

    // A user category replaces the content type's priority, so the two never stack.
    const priority = cat ? cat.priority : prefs.contentPriority[contentType];
    if (priority !== 'normal') {
      const points = priority === 'high' ? w.priorityPoints : -w.priorityPoints;
      total += points;
      reasons.push(cat ? { code: 'category', points, name: cat.name, priority } : { code: 'priority', points, contentType, priority });
    }

    const topic = matchTopic(text);
    if (topic) {
      total += w.topicPoints;
      reasons.push({ code: 'topic', points: w.topicPoints, topic });
    }

    if (isLowPriority(host)) {
      total -= w.lowPrioritySitePoints;
      reasons.push({ code: 'lowPrioritySite', points: -w.lowPrioritySitePoints });
    }

    if (signals.pinned) reasons.push({ code: 'pinned', points: 0 });
    if (signals.audible) reasons.push({ code: 'audible', points: 0 });

    return {
      score: Math.round(Math.min(100, Math.max(0, total))),
      contentType,
      category,
      group,
      indexPolicy,
      protected: signals.pinned || signals.audible || signals.active,
      reasons,
    };
  }

  return {
    score,
    isArchiveCandidate: (result) => !result.protected && result.score < prefs.archiveThreshold,
  };
}

/** One-off convenience. Prefer createScorer when scoring many tabs. */
export function scoreTab(signals: TabSignals, prefs: Preferences, now: number): TabScore {
  return createScorer(prefs).score(signals, now);
}
