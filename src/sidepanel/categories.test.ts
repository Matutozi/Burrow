import { describe, expect, it } from 'vitest';
import { fromDrafts, toDrafts } from './Categories';

describe('category drafts', () => {
  it('round-trips categories through the editor format', () => {
    const cats = [
      {
        id: 'ieee',
        name: 'IEEE',
        priority: 'high' as const,
        indexPolicy: 'full' as const,
        domains: ['ieee.org'],
        keywords: ['call for papers'],
      },
    ];
    expect(fromDrafts(toDrafts(cats))).toEqual(cats);
  });

  it('parses typed sites and words, and drops unnamed drafts', () => {
    expect(
      fromDrafts([
        {
          id: 'a',
          name: ' Travel grants ',
          priority: 'high',
          indexPolicy: 'title',
          sitesText: 'https://www.daad.de/x, nope',
          keywordsText: 'Travel Grant,\nfellowship',
        },
        { id: 'b', name: '  ', priority: 'low', indexPolicy: 'title', sitesText: 'x.com', keywordsText: '' },
      ]),
    ).toEqual([
      {
        id: 'a',
        name: 'Travel grants',
        priority: 'high',
        indexPolicy: 'title',
        domains: ['daad.de'],
        keywords: ['travel grant', 'fellowship'],
      },
    ]);
  });
});
