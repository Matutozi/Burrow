import { describe, expect, it } from 'vitest';
import { applyDelta, EMPTY_STATS, estimatedMbFreed, ESTIMATED_MB_PER_TAB, sanitizeStats } from './stats';

describe('stats', () => {
  it('counts tabs put away, keeps the first date, and never goes below zero', () => {
    const a = applyDelta(EMPTY_STATS, 5, 100);
    expect(a).toEqual({ tabsPutAway: 5, since: 100 });
    const b = applyDelta(a, 3, 200);
    expect(b).toEqual({ tabsPutAway: 8, since: 100 });
    expect(applyDelta(b, -20, 300)).toEqual(EMPTY_STATS);
    expect(estimatedMbFreed(b)).toBe(8 * ESTIMATED_MB_PER_TAB);
  });

  it('repairs stored values', () => {
    expect(sanitizeStats('x')).toEqual(EMPTY_STATS);
    expect(sanitizeStats({ tabsPutAway: -4, since: 5 })).toEqual(EMPTY_STATS);
    expect(sanitizeStats({ tabsPutAway: 3.7, since: 'x' })).toEqual({ tabsPutAway: 3, since: 0 });
  });
});
