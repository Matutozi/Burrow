import { describe, expect, it } from 'vitest';
import { defaultPreferences } from '../prefs/defaults';
import type { Preferences } from '../prefs/types';
import { createScorer, createTopicMatcher, scoreTab, type TabScore, type TabSignals } from './score';

const isArchiveCandidate = (r: TabScore, p: Preferences) => createScorer(p).isArchiveCandidate(r);

const NOW = Date.UTC(2026, 10, 20, 12);
const DAY = 24 * 60 * 60 * 1000;

function tab(overrides: Partial<TabSignals> = {}): TabSignals {
  return {
    url: 'https://example.com/page',
    title: 'Example page',
    lastAccessed: NOW,
    pinned: false,
    audible: false,
    active: false,
    ...overrides,
  };
}

describe('scoreTab', () => {
  const prefs = defaultPreferences('general');

  it('gives a just-opened tab the full recency score', () => {
    expect(scoreTab(tab(), prefs, NOW).score).toBe(70);
  });

  it('decays with age and becomes an archive candidate once stale', () => {
    const fresh = scoreTab(tab({ lastAccessed: NOW - DAY }), prefs, NOW);
    const stale = scoreTab(tab({ lastAccessed: NOW - 3 * DAY }), prefs, NOW);
    expect(fresh.score).toBe(35);
    expect(stale.score).toBe(9);
    expect(isArchiveCandidate(fresh, prefs)).toBe(false);
    expect(isArchiveCandidate(stale, prefs)).toBe(true);
  });

  it('decays more slowly when the user picks a longer stale period', () => {
    const patient = { ...prefs, staleAfterDays: 7 };
    const threeDaysOld = tab({ lastAccessed: NOW - 3 * DAY });
    expect(scoreTab(threeDaysOld, patient, NOW).score).toBe(29);
    expect(scoreTab(threeDaysOld, prefs, NOW).score).toBe(9);
  });

  it('applies content priority from preferences', () => {
    const dev = defaultPreferences('developer');
    const docs = scoreTab(tab({ url: 'https://developer.mozilla.org/en-US/docs/Web', lastAccessed: NOW - DAY }), dev, NOW);
    const social = scoreTab(tab({ url: 'https://www.reddit.com/r/chrome', lastAccessed: NOW - DAY }), dev, NOW);
    expect(docs.contentType).toBe('docs');
    expect(docs.score).toBe(55);
    expect(social.contentType).toBe('social');
    expect(social.score).toBe(15);
    expect(social.reasons).toContainEqual({ code: 'priority', points: -20, contentType: 'social', priority: 'low' });
  });

  it('boosts tabs that match a topic', () => {
    const p = { ...prefs, topics: ['react'] };
    const hit = scoreTab(tab({ title: 'Learning React hooks', lastAccessed: NOW - DAY }), p, NOW);
    const miss = scoreTab(tab({ title: 'Reactive cooking', lastAccessed: NOW - DAY }), p, NOW);
    expect(hit.score).toBe(50);
    expect(miss.score).toBe(35);
  });

  it('treats always-important sites as protected 100s, including subdomains', () => {
    const p = { ...prefs, alwaysImportant: ['atlassian.net'] };
    const r = scoreTab(tab({ url: 'https://acme.atlassian.net/browse/X-1', lastAccessed: NOW - 30 * DAY }), p, NOW);
    expect(r.score).toBe(100);
    expect(r.protected).toBe(true);
  });

  it('penalises low-priority domains', () => {
    const p = { ...prefs, lowPriority: ['example.com'] };
    expect(scoreTab(tab(), p, NOW).score).toBe(45);
  });

  it('protects pinned, audible and active tabs regardless of score', () => {
    const old = NOW - 30 * DAY;
    for (const flags of [{ pinned: true }, { audible: true }, { active: true }]) {
      const r = scoreTab(tab({ lastAccessed: old, ...flags }), prefs, NOW);
      expect(r.protected).toBe(true);
      expect(isArchiveCandidate(r, prefs)).toBe(false);
    }
  });

  it('adds activity points, capped at 15', () => {
    const busy = scoreTab(tab({ visitCount: 1000, activeMs: 10 * 60 * 60 * 1000 }), prefs, NOW);
    expect(busy.score).toBe(85);
  });

  it('clamps scores to 0-100', () => {
    const p = { ...defaultPreferences('developer'), lowPriority: ['reddit.com'] };
    const r = scoreTab(tab({ url: 'https://reddit.com', lastAccessed: NOW - 60 * DAY }), p, NOW);
    expect(r.score).toBe(0);
  });

  it('never returns a future-dated negative age', () => {
    expect(scoreTab(tab({ lastAccessed: NOW + DAY }), prefs, NOW).score).toBe(70);
  });
});

describe('createTopicMatcher', () => {
  it('matches whole words, case-insensitively', () => {
    expect(createTopicMatcher(['machine learning'])('Intro to Machine Learning')).toBe('machine learning');
    expect(createTopicMatcher(['rust'])('https://site.com/rust/book')).toBe('rust');
    expect(createTopicMatcher(['rust'])('Trustworthy')).toBeNull();
  });

  it('handles topics with regex characters', () => {
    expect(createTopicMatcher(['c++'])('C++ tips')).toBe('c++');
    expect(createTopicMatcher(['a.b'])('axb')).toBeNull();
  });

  it('prefers the longer topic when both match', () => {
    expect(createTopicMatcher(['machine', 'machine learning'])('machine learning 101')).toBe('machine learning');
  });

  it('matches nothing when there are no topics', () => {
    expect(createTopicMatcher([' ', ''])('anything')).toBeNull();
  });
});

describe('createScorer', () => {
  it('is fast enough for 1,000 tabs with 100 topics', () => {
    const prefs = { ...defaultPreferences(), topics: Array.from({ length: 100 }, (_, i) => `topic${i}`) };
    const scorer = createScorer(prefs);
    const run = () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) scorer.score(tab({ url: `https://site${i}.com/x`, title: `Title ${i}` }), NOW);
      return performance.now() - start;
    };
    // Best of five: other test files run in parallel, so a single timing is noisy under load.
    expect(Math.min(...Array.from({ length: 5 }, run))).toBeLessThan(50);
  });

  it('uses the configurable activity curve', () => {
    const prefs = defaultPreferences();
    const half = createScorer(prefs).score(tab({ visitCount: 10 }), NOW);
    expect(half.score).toBe(78); // 70 + 15 * (1 + 0) / 2
    const tuned = { ...prefs, weights: { ...prefs.weights, activityFullVisits: 1 } };
    expect(createScorer(tuned).score(tab({ visitCount: 1 }), NOW).score).toBe(78);
  });
});

describe('custom categories', () => {
  const categories = [
    {
      id: 'ieee',
      name: 'IEEE opportunities',
      priority: 'high' as const,
      indexPolicy: 'full' as const,
      domains: ['ieee.org'],
      keywords: ['call for papers'],
    },
    {
      id: 'travel',
      name: 'Travel grant',
      priority: 'low' as const,
      indexPolicy: 'never' as const,
      domains: [],
      keywords: ['travel grant', 'travel award'],
    },
  ];
  const prefs = { ...defaultPreferences(), customCategories: categories };
  const scorer = createScorer(prefs);

  it('matches by site or keyword, first category wins, and labels the tab', () => {
    expect(scorer.score(tab({ url: 'https://conf.ieee.org/x', title: 'Home' }), NOW).category).toEqual({
      id: 'ieee',
      name: 'IEEE opportunities',
    });
    expect(scorer.score(tab({ url: 'https://uni.edu/a', title: 'Apply for a Travel Grant now' }), NOW).category?.id).toBe(
      'travel',
    );
    expect(scorer.score(tab({ url: 'https://uni.edu/a', title: 'Grants and travel' }), NOW).category).toBeNull();
    expect(scorer.score(tab({ url: 'https://x.org/ieee', title: 'Call for papers: travel grant' }), NOW).category?.id).toBe(
      'ieee',
    );
  });

  it("uses the category's priority instead of the content type's, never both", () => {
    const withDocsHigh = createScorer({ ...prefs, contentPriority: { ...prefs.contentPriority, docs: 'high' } });
    const r = withDocsHigh.score(tab({ url: 'https://docs.ieee.org/reference/x', title: 'x' }), NOW);
    const priorityReasons = r.reasons.filter((x) => x.code === 'priority' || x.code === 'category');
    expect(priorityReasons).toEqual([{ code: 'category', points: 20, name: 'IEEE opportunities', priority: 'high' }]);
    const low = withDocsHigh.score(tab({ url: 'https://uni.edu/travel-grant', title: 'travel grant' }), NOW);
    expect(low.reasons).toContainEqual({ code: 'category', points: -20, name: 'Travel grant', priority: 'low' });
  });

  it("uses the category's save policy, else the content type's", () => {
    expect(scorer.score(tab({ url: 'https://uni.edu/a', title: 'travel award' }), NOW).indexPolicy).toBe('never');
    expect(scorer.score(tab({ url: 'https://ieee.org', title: 'x' }), NOW).indexPolicy).toBe('full');
    expect(scorer.score(tab({ url: 'https://mail.google.com', title: 'x' }), NOW).indexPolicy).toBe('never');
  });
});

describe('tab groups', () => {
  const courses = {
    id: 'courses',
    name: 'Courses',
    priority: 'high' as const,
    indexPolicy: 'full' as const,
    domains: [],
    keywords: [],
  };
  const travel = { ...courses, id: 'travel', name: 'Travel grant', priority: 'low' as const, keywords: ['grant'] };

  it('puts a tab in the category named like its group, ahead of keyword matches', () => {
    const scorer = createScorer({ ...defaultPreferences(), useTabGroups: true, customCategories: [travel, courses] });
    const r = scorer.score(tab({ url: 'https://uni.edu/x', title: 'grant writing', groupTitle: ' courses ' }), NOW);
    expect(r.category?.id).toBe('courses');
    expect(r.group).toBe('courses');
    expect(r.indexPolicy).toBe('full');
  });

  it('keeps an unmatched group name as a label without changing priority', () => {
    const scorer = createScorer({ ...defaultPreferences(), useTabGroups: true });
    const r = scorer.score(tab({ url: 'https://uni.edu/x', title: 'x', groupTitle: 'Thesis' }), NOW);
    expect(r.group).toBe('Thesis');
    expect(r.category).toBeNull();
  });

  it('ignores groups when tab group support is off', () => {
    const scorer = createScorer({ ...defaultPreferences(), customCategories: [courses] });
    const r = scorer.score(tab({ url: 'https://uni.edu/x', title: 'x', groupTitle: 'Courses' }), NOW);
    expect(r.group).toBeNull();
    expect(r.category).toBeNull();
  });
});

describe('verdict', () => {
  it('puts tabs in plain-word bands derived from the threshold', () => {
    const scorer = createScorer({ ...defaultPreferences(), archiveThreshold: 30 });
    const r = (score: number, prot = false) => ({
      score,
      contentType: 'other' as const,
      category: null,
      group: null,
      indexPolicy: 'title' as const,
      protected: prot,
      reasons: [],
    });
    expect(scorer.verdict(r(29))).toBe('putAway');
    expect(scorer.verdict(r(30))).toBe('notSure');
    expect(scorer.verdict(r(64))).toBe('notSure');
    expect(scorer.verdict(r(65))).toBe('keep');
    expect(scorer.verdict(r(5, true))).toBe('keep');
  });
});
