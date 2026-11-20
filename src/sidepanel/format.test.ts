import { describe, expect, it } from 'vitest';
import { formatAge, formatArchiveResult, formatReasons } from './format';

describe('formatAge', () => {
  it.each([
    [0, 'just now'],
    [-5000, 'just now'],
    [5 * 60000, '5m ago'],
    [3 * 3600000, '3h ago'],
    [86400000, '1 day ago'],
    [3 * 86400000, '3 days ago'],
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatAge(ms)).toBe(expected);
  });
});

describe('formatReasons', () => {
  it('words every reason with its signed points', () => {
    expect(
      formatReasons([
        { code: 'lastOpened', points: 9, ageMs: 3 * 86400000 },
        { code: 'priority', points: -20, contentType: 'social', priority: 'low' },
        { code: 'topic', points: 15, topic: 'react' },
        { code: 'pinned', points: 0 },
      ]),
    ).toBe('last opened 3 days ago (+9) · social media: low priority (-20) · matches "react" (+15) · pinned');
  });

  it('summarises an archive run', () => {
    expect(formatArchiveResult(1, 0, 0, 0)).toBe('Archived 1 tab');
    expect(formatArchiveResult(3, 1, 2, 0)).toBe(
      'Archived 3 tabs · 1 tab couldn\'t be closed but is saved · 2 sensitive tabs left open (set to "never save")',
    );
    expect(formatArchiveResult(0, 0, 0, 0)).toBe('Nothing to archive');
  });
});
