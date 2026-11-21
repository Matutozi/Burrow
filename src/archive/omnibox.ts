/**
 * Address-bar search ("burrow <words>"). Pure: turns archive matches into Chrome omnibox
 * suggestions. Chrome renders suggestion descriptions as XML, so all page text is escaped.
 */
import { hostOf } from '../prefs/classify';
import type { ArchiveRecord, ArchiveSearch } from './record';

export const OMNIBOX_LIMITS = {
  /** Chrome shows only a handful of suggestions. */
  maxSuggestions: 6,
  maxTitleChars: 100,
} as const;

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

export interface Suggestion {
  /** What Chrome passes back when the user picks it: the page address. */
  content: string;
  description: string;
}

/** Wraps each query word found in `text` in <match> tags. Input is plain text; output is escaped XML. */
export function highlight(text: string, query: string): string {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  if (words.length === 0) return escapeXml(text);
  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let at = lower.indexOf(w); at !== -1; at = lower.indexOf(w, at + w.length)) {
      for (let i = at; i < at + w.length; i++) marks[i] = true;
    }
  }
  let out = '';
  let open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] !== open) {
      out += open ? '</match>' : '<match>';
      open = !open;
    }
    out += escapeXml(text[i] ?? '');
  }
  return open ? `${out}</match>` : out;
}

export function toSuggestion(r: ArchiveRecord, query: string, label: string): Suggestion {
  const title = (r.title || r.url).slice(0, OMNIBOX_LIMITS.maxTitleChars);
  return {
    content: r.url,
    // Show the "Save under" name when there is one, so "burrow school" makes clear why a page matched.
    description: `${highlight(title, query)} <dim>· ${r.label ? highlight(r.label, query) : escapeXml(label)} · ${escapeXml(hostOf(r.url) ?? '')}</dim>`,
  };
}

export function suggest(search: ArchiveSearch, query: string, label: string): Suggestion[] {
  if (!query.trim()) return [];
  return search(query)
    .slice(0, OMNIBOX_LIMITS.maxSuggestions)
    .map((r) => toSuggestion(r, query, label));
}

/** Picks what to open when the user presses Enter: the chosen suggestion, else the best match. */
export function resolveEntered(text: string, records: ArchiveRecord[], search: ArchiveSearch): ArchiveRecord | null {
  return records.find((r) => r.url === text) ?? search(text)[0] ?? null;
}
