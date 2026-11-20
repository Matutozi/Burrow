/**
 * Page-text capture for archived pages. The extractor runs inside the page; everything else is
 * pure and unit-tested. Capture is best effort: if it fails or times out, the page is archived
 * with its title only, and archiving is never blocked.
 */

export const CAPTURE_LIMITS = {
  /** Characters of text kept per page. Enough to search a page, small enough to keep the archive light. */
  maxTextChars: 8000,
  /** Characters the extractor may send back before cleaning. */
  maxRawChars: 32000,
  /** Give up on a page after this long. */
  timeoutMs: 3000,
  /** Pages read at the same time. */
  concurrency: 4,
} as const;

/** What the user grants when turning on page-text capture. Same list as the manifest's optional entries. */
export const CAPTURE_PERMISSIONS = {
  permissions: ['scripting'],
  origins: ['https://*/*', 'http://*/*'],
} satisfies chrome.permissions.Permissions;

/**
 * Runs in the page (isolated world), so it must be self-contained: no imports, no closures.
 * Returns null on pages with a password field, so login and account pages never have text saved.
 */
export function extractPageText(maxRawChars: number): string | null {
  if (document.querySelector('input[type="password"]')) return null;
  const root = document.querySelector('article') ?? document.querySelector('main') ?? document.body;
  if (!root) return null;
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
  return `${description}\n${root.innerText}`.slice(0, maxRawChars);
}

/** Collapses whitespace and cuts at a word boundary. Returns '' when there is nothing useful. */
export function cleanText(raw: unknown, maxChars: number = CAPTURE_LIMITS.maxTextChars): string {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const space = cut.lastIndexOf(' ');
  return space > maxChars * 0.8 ? cut.slice(0, space) : cut;
}

/** Rejects after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Like Promise.all over `items`, with at most `limit` calls running at once. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

/**
 * Reads text from each tab, a few at a time. Returns cleaned text per tab id; tabs that failed,
 * timed out, or had nothing to save are left out.
 */
export async function captureTexts(
  tabIds: number[],
  read: (tabId: number) => Promise<unknown>,
  limits: { timeoutMs: number; concurrency: number; maxTextChars: number } = CAPTURE_LIMITS,
): Promise<Map<number, string>> {
  const texts = await mapLimit(tabIds, limits.concurrency, async (id) => {
    try {
      return cleanText(await withTimeout(read(id), limits.timeoutMs), limits.maxTextChars);
    } catch {
      return '';
    }
  });
  const out = new Map<number, string>();
  tabIds.forEach((id, i) => {
    const text = texts[i];
    if (text) out.set(id, text);
  });
  return out;
}
