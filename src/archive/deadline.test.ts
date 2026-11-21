import { describe, expect, it } from 'vitest';
import { closingSoon, daysLeft, findDeadline } from './deadline';

const NOW = Date.UTC(2026, 10, 21, 12); // 21 Nov 2026
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 23, 59, 59);

describe('findDeadline', () => {
  it.each([
    ['Application deadline: 30 November 2026', day(2026, 11, 30)],
    ['Applications close on Dec 5, 2026 at noon', day(2026, 12, 5)],
    ['Apply by 2026-12-01.', day(2026, 12, 1)],
    ['Deadline 3rd of January', day(2027, 1, 3)],
    ['Closing date: 25th Nov', day(2026, 11, 25)],
    ['Submission deadline - March 15 2027', day(2027, 3, 15)],
    ['Registration closes Sept 2', day(2027, 9, 2)],
  ])('%s', (text, expected) => {
    expect(findDeadline(text, NOW)).toBe(expected);
  });

  it('ignores dates not tied to a deadline word, past deadlines, and impossible dates', () => {
    expect(findDeadline('Published 30 November 2026. Great read.', NOW)).toBeNull();
    expect(findDeadline('Deadline: 1 October 2026', NOW)).toBeNull();
    expect(findDeadline('Deadline: 31 June 2027', NOW)).toBeNull();
    expect(findDeadline('', NOW)).toBeNull();
  });

  it('picks the earliest upcoming deadline when there are several', () => {
    expect(findDeadline('Round 1 deadline: 10 Jan 2027. Final deadline: 1 December 2026.', NOW)).toBe(day(2026, 12, 1));
  });
});

describe('closingSoon', () => {
  it('lists saved pages closing within the window, soonest first', () => {
    const recs = [
      { id: 'a', deadline: NOW + 5 * 86_400_000 },
      { id: 'b', deadline: NOW + 1 * 86_400_000 },
      { id: 'c', deadline: NOW + 30 * 86_400_000 },
      { id: 'd', deadline: NOW - 86_400_000 },
      { id: 'e' },
    ];
    expect(closingSoon(recs, NOW, 7).map((r) => r.id)).toEqual(['b', 'a']);
    expect(daysLeft(NOW + 1.5 * 86_400_000, NOW)).toBe(1);
  });
});
