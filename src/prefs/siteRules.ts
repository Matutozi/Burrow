import { CONTENT_TYPES, type ContentType, type SiteRule } from './types';
import { cleanDomain } from './validate';

export interface ParseResult {
  rules: SiteRule[];
  /** Lines that could not be understood, so the UI can point at them. */
  invalid: string[];
}

const TYPES = new Set<string>(CONTENT_TYPES);

/** Parses lines like "github.com = work". Later lines override earlier ones for the same domain. */
export function parseSiteRules(text: string): ParseResult {
  const byDomain = new Map<string, ContentType>();
  const invalid: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [left, right, ...rest] = line.split('=');
    const domain = cleanDomain(left ?? '');
    const type = (right ?? '').trim().toLowerCase();
    if (rest.length || !domain || !TYPES.has(type)) {
      invalid.push(line);
      continue;
    }
    byDomain.set(domain, type as ContentType);
  }
  return { rules: [...byDomain].map(([domain, type]) => ({ domain, type })), invalid };
}

export function formatSiteRules(rules: SiteRule[]): string {
  return rules.map((r) => `${r.domain} = ${r.type}`).join('\n');
}
