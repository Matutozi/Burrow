/**
 * Spots application deadlines in a page's title or text ("Deadline: 30 November 2026",
 * "Applications close on Dec 5", "Apply by 2026-12-01"). Pure and offline. Only dates right after a
 * deadline word count, so ordinary dates on a page are never mistaken for deadlines.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far after a deadline word the date may appear. */
const WINDOW = 80;

const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const KEYWORD =
  /\b(deadline|due date|due by|due on|closes?|closing date|close on|apply by|apply before|applications? (?:close|due|deadline)|submit by|submission deadline|register by|registration closes|until|ends? on|last day)\b/gi;

const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?,?(?:\\s+(\\d{4}))?\\b`, 'i');
const MONTH_DAY = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i');
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;

/** End of the given day (UTC), or null if the day doesn't exist (e.g. 31 June). */
function endOfDay(year: number, month: number, day: number): number | null {
  const t = Date.UTC(year, month, day, 23, 59, 59);
  const d = new Date(t);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day ? t : null;
}

/** A date with no year means its next occurrence (allowing a day of grace). */
function resolve(month: number, day: number, year: number | undefined, now: number): number | null {
  if (year !== undefined) return endOfDay(year, month, day);
  const thisYear = new Date(now).getUTCFullYear();
  const t = endOfDay(thisYear, month, day);
  if (t !== null && t >= now - DAY_MS) return t;
  return endOfDay(thisYear + 1, month, day);
}

function firstDate(text: string, now: number): number | null {
  const found: { at: number; t: number | null }[] = [];
  const dm = DAY_MONTH.exec(text);
  if (dm) {
    const m = MONTH_INDEX[(dm[2] ?? '').slice(0, 3).toLowerCase()];
    if (m !== undefined)
      found.push({ at: dm.index, t: resolve(m, Number(dm[1]), dm[3] ? Number(dm[3]) : undefined, now) });
  }
  const md = MONTH_DAY.exec(text);
  if (md) {
    const m = MONTH_INDEX[(md[1] ?? '').slice(0, 3).toLowerCase()];
    if (m !== undefined)
      found.push({ at: md.index, t: resolve(m, Number(md[2]), md[3] ? Number(md[3]) : undefined, now) });
  }
  const iso = ISO.exec(text);
  if (iso) found.push({ at: iso.index, t: endOfDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) });
  found.sort((a, b) => a.at - b.at);
  return found.find((f) => f.t !== null)?.t ?? null;
}

/** The earliest upcoming deadline mentioned in `text`, or null. */
export function findDeadline(text: string, now: number): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(KEYWORD)) {
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + WINDOW);
    const t = firstDate(after, now);
    if (t !== null && t >= now - DAY_MS && (best === null || t < best)) best = t;
  }
  return best;
}

/** Saved pages whose deadline falls between now and `days` from now, soonest first. */
export function closingSoon<T extends { deadline?: number }>(records: T[], now: number, days: number): T[] {
  const until = now + days * DAY_MS;
  return records
    .filter((r) => r.deadline !== undefined && r.deadline >= now && r.deadline <= until)
    .sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0));
}

/** Whole days left (0 means today). */
export function daysLeft(deadline: number, now: number): number {
  return Math.max(0, Math.floor((deadline - now) / DAY_MS));
}
