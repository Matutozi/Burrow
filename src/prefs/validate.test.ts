import { describe, expect, it } from 'vitest';
import { createScorer } from '../scoring/score';
import { DEFAULT_WEIGHTS, defaultPreferences } from './defaults';
import { cleanDomain, LIMITS, sanitizePreferences } from './validate';

describe('sanitizePreferences', () => {
  it('returns defaults for non-objects', () => {
    for (const input of [undefined, null, 42, 'x', []]) {
      expect(sanitizePreferences(input)).toEqual(defaultPreferences());
    }
  });

  it('is idempotent on valid data', () => {
    const prefs = { ...defaultPreferences('developer'), onboarded: true, topics: ['react'], updatedAt: 5 };
    expect(sanitizePreferences(sanitizePreferences(prefs))).toEqual(prefs);
  });

  it('repairs wrong types instead of crashing', () => {
    const p = sanitizePreferences({
      topics: 'react',
      weights: { recencyMax: '50', topicPoints: 'lots', priorityPoints: NaN },
      staleAfterDays: NaN,
      mode: 'delete-everything',
      persona: 'hacker',
      contentPriority: { docs: 'urgent', video: 'low' },
      trackActivity: 'yes',
    });
    expect(p.topics).toEqual([]);
    expect(p.weights.recencyMax).toBe(50);
    expect(p.weights.topicPoints).toBe(DEFAULT_WEIGHTS.topicPoints);
    expect(p.weights.priorityPoints).toBe(DEFAULT_WEIGHTS.priorityPoints);
    expect(p.staleAfterDays).toBe(3);
    expect(p.mode).toBe('suggest');
    expect(p.persona).toBe('general');
    expect(p.contentPriority.docs).toBe('normal');
    expect(p.contentPriority.video).toBe('low');
    expect(p.trackActivity).toBe(true);
    // The scorer must work on whatever comes out.
    const s = createScorer(p).score({ url: 'https://a.com', title: '', lastAccessed: 0, pinned: false, audible: false, active: false }, 1e9);
    expect(Number.isFinite(s.score)).toBe(true);
  });

  it('clamps numbers to safe ranges', () => {
    const p = sanitizePreferences({ staleAfterDays: 0, archiveThreshold: 500, idleAfterSeconds: 1, weights: { recencyMax: -10 } });
    expect(p.staleAfterDays).toBe(LIMITS.staleAfterDays.min);
    expect(p.archiveThreshold).toBe(100);
    expect(p.idleAfterSeconds).toBe(15);
    expect(p.weights.recencyMax).toBe(0);
  });

  it('cleans, de-duplicates and caps lists', () => {
    const p = sanitizePreferences({
      alwaysImportant: ['https://www.Gmail.com/x', 'gmail.com', 'not a domain!', 42, ''],
      topics: ['  React ', 'react', 'x'.repeat(500), 7],
      lowPriority: Array.from({ length: 2000 }, (_, i) => `site${i}.com`),
    });
    expect(p.alwaysImportant).toEqual(['gmail.com']);
    expect(p.topics).toEqual(['react', 'x'.repeat(LIMITS.maxTopicLength)]);
    expect(p.lowPriority).toHaveLength(LIMITS.maxDomains);
  });

  it('drops invalid site rules', () => {
    const p = sanitizePreferences({
      siteRules: [{ domain: 'GitHub.com', type: 'work' }, { domain: 'a.com', type: 'banana' }, { domain: '', type: 'work' }, 'junk'],
    });
    expect(p.siteRules).toEqual([{ domain: 'github.com', type: 'work' }]);
  });

  it('applies persona defaults for missing priorities', () => {
    const p = sanitizePreferences({ persona: 'developer', contentPriority: {} });
    expect(p.contentPriority.code).toBe('high');
  });
});

describe('migration', () => {
  it('upgrades v1 data with page-text capture off', () => {
    const p = sanitizePreferences({ version: 1, topics: ['kept'], captureText: true });
    expect(p.version).toBe(3);
    expect(p.captureText).toBe(false);
    expect(p.topics).toEqual(['kept']);
  });

  it('upgrades v2 data to v3 with automatic archiving off until the user turns it on again', () => {
    const p = sanitizePreferences({ version: 2, mode: 'auto', captureText: true });
    expect(p.version).toBe(3);
    expect(p.mode).toBe('suggest');
    expect(p.captureText).toBe(true);
    expect(p.autoArchiveMaxPerRun).toBe(20);
    expect(sanitizePreferences({ version: 3, mode: 'auto' }).mode).toBe('auto');
  });

  it('clamps automatic archiving limits', () => {
    const p = sanitizePreferences({ version: 3, autoArchiveEveryMinutes: 1, autoArchiveAfterHours: 1e9, autoArchiveMaxPerRun: 'x' });
    expect([p.autoArchiveEveryMinutes, p.autoArchiveAfterHours, p.autoArchiveMaxPerRun]).toEqual([15, 720, 20]);
  });

  it('keeps captureText for v2 data', () => {
    expect(sanitizePreferences({ version: 2, captureText: true }).captureText).toBe(true);
    expect(sanitizePreferences({ version: 2, captureText: 'yes' }).captureText).toBe(false);
  });
});

describe('cleanDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['localhost', 'localhost'],
    ['https://sub.example.co.uk/path', 'sub.example.co.uk'],
    ['javascript:alert(1)', ''],
    ['no spaces allowed.com', ''],
    ['singleword', ''],
  ])('%s -> %s', (input, expected) => {
    expect(cleanDomain(input)).toBe(expected);
  });
});
