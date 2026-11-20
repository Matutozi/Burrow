import { describe, expect, it } from 'vitest';
import { defaultPreferences } from '../prefs/defaults';
import { isArchiveCandidate, matchedTopics, scoreTab, type TabSignals } from './score';

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
    expect(social.reasons.map((r) => r.label)).toContain('social is low priority for you');
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

describe('matchedTopics', () => {
  it('matches whole words in title or URL, case-insensitively', () => {
    expect(matchedTopics({ title: 'Intro to Machine Learning', url: 'https://x.com' }, ['machine learning'])).toEqual(['machine learning']);
    expect(matchedTopics({ title: 'x', url: 'https://site.com/rust/book' }, ['rust'])).toEqual(['rust']);
    expect(matchedTopics({ title: 'Trustworthy', url: 'https://a.com' }, ['rust'])).toEqual([]);
  });

  it('handles topics with regex characters', () => {
    expect(matchedTopics({ title: 'C++ tips', url: 'https://a.com' }, ['c++'])).toEqual(['c++']);
  });
});
