import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { formatSiteRules, parseSiteRules } from './siteRules';

describe('parseSiteRules', () => {
  it('parses valid lines and normalises domains', () => {
    const { rules, invalid } = parseSiteRules('https://www.GitHub.com/x = Work\n\nyoutube.com=docs');
    expect(rules).toEqual([
      { domain: 'github.com', type: 'work' },
      { domain: 'youtube.com', type: 'docs' },
    ]);
    expect(invalid).toEqual([]);
  });

  it('reports lines it cannot understand', () => {
    const { rules, invalid } = parseSiteRules('github.com\nexample.com = banana\na.com = b = c');
    expect(rules).toEqual([]);
    expect(invalid).toEqual(['github.com', 'example.com = banana', 'a.com = b = c']);
  });

  it('lets later lines win for the same domain', () => {
    expect(parseSiteRules('a.com = work\na.com = news').rules).toEqual([{ domain: 'a.com', type: 'news' }]);
  });

  it('round-trips through formatSiteRules', () => {
    const rules = [{ domain: 'a.com', type: 'work' as const }];
    expect(parseSiteRules(formatSiteRules(rules)).rules).toEqual(rules);
  });
});

describe('classify with user rules', () => {
  it('user rules beat built-in lists', () => {
    expect(classify('https://github.com/x', { siteRules: [{ domain: 'github.com', type: 'work' }] })).toBe('work');
  });

  it('the most specific rule wins', () => {
    const siteRules = [
      { domain: 'google.com', type: 'work' as const },
      { domain: 'mail.google.com', type: 'email' as const },
    ];
    expect(classify('https://mail.google.com/u/0', { siteRules })).toBe('email');
    expect(classify('https://drive.google.com', { siteRules })).toBe('work');
  });

  it('built-ins can be switched off', () => {
    expect(classify('https://github.com', { useBuiltIns: false })).toBe('other');
  });
});
