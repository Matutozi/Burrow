import { describe, expect, it } from 'vitest';
import { captureTexts, cleanText, mapLimit, withTimeout } from './capture';
import { buildRecord, createArchiveSearch, sanitizeRecord, textSnippet, withoutText, ARCHIVE_VERSION } from './record';

describe('cleanText', () => {
  it('collapses whitespace and rejects non-strings', () => {
    expect(cleanText('  a\n\n b\t c  ')).toBe('a b c');
    expect(cleanText(null)).toBe('');
    expect(cleanText(42)).toBe('');
  });

  it('cuts long text at a word boundary', () => {
    expect(cleanText('alpha beta gamma delta', 19)).toBe('alpha beta gamma');
    expect(cleanText('x'.repeat(50), 10)).toBe('x'.repeat(10));
  });
});

describe('mapLimit', () => {
  it('keeps order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 * (7 - n)));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe('captureTexts', () => {
  it('keeps text that arrived and skips failures, timeouts and empty pages', async () => {
    const read = async (id: number) => {
      if (id === 2) throw new Error('cannot access a chrome:// URL');
      if (id === 3) return new Promise(() => undefined); // never resolves
      if (id === 4) return null; // password page
      return `  page ${id}  text `;
    };
    const out = await captureTexts([1, 2, 3, 4], read, { timeoutMs: 20, concurrency: 4, maxTextChars: 100 });
    expect([...out]).toEqual([[1, 'page 1 text']]);
  });

  it('withTimeout passes through fast results', async () => {
    expect(await withTimeout(Promise.resolve('ok'), 50)).toBe('ok');
    await expect(withTimeout(new Promise(() => undefined), 5)).rejects.toThrow('timed out');
  });
});

describe('records with page text', () => {
  const input = { url: 'https://a.com/post', title: 'A post', contentType: 'article' as const, score: 10 };

  it('keeps text only for the full policy', async () => {
    expect(await buildRecord({ ...input, text: ' some  text ' }, 'full', 1)).toMatchObject({ saved: 'full', text: 'some text' });
    const titleOnly = await buildRecord({ ...input, text: 'some text' }, 'title', 1);
    expect(titleOnly?.saved).toBe('title');
    expect(titleOnly).not.toHaveProperty('text');
    expect((await buildRecord({ ...input, text: '   ' }, 'full', 1))?.saved).toBe('title');
  });

  it('reads v1 records and drops text that is not marked full', () => {
    expect(sanitizeRecord({ v: 1, url: 'https://a.com', saved: 'title' }, 'x')).toMatchObject({ v: ARCHIVE_VERSION, saved: 'title' });
    expect(sanitizeRecord({ url: 'https://a.com', saved: 'title', text: 'leak' }, 'x')).not.toHaveProperty('text');
    expect(sanitizeRecord({ url: 'https://a.com', saved: 'full', text: 42 }, 'x')?.saved).toBe('title');
  });

  it('withoutText strips text', async () => {
    const rec = await buildRecord({ ...input, text: 'body' }, 'full', 1);
    if (!rec) throw new Error('missing');
    expect(withoutText(rec)).toEqual({ ...rec, saved: 'title', text: undefined });
    expect(withoutText(rec)).not.toHaveProperty('text');
  });

  it('searches inside page text and shows a snippet around the match', async () => {
    const rec = await buildRecord({ ...input, text: `${'intro '.repeat(30)}the quokka is a small marsupial ${'end '.repeat(30)}` }, 'full', 1);
    const other = await buildRecord({ ...input, url: 'https://b.com', title: 'Other' }, 'full', 1);
    if (!rec || !other) throw new Error('missing');
    const search = createArchiveSearch([rec, other]);
    expect(search('QUOKKA marsupial')).toEqual([rec]);
    expect(search('post')).toEqual([rec]);
    const snip = textSnippet(rec, 'quokka', 10);
    expect(snip).toMatch(/^….*quokka.*…$/);
    expect(textSnippet(rec, 'post')).toBeNull();
    expect(textSnippet(other, 'quokka')).toBeNull();
  });

  it('keeps the category name and finds pages by it', async () => {
    const r = await buildRecord({ ...input, title: 'Deadline soon', category: '  IEEE opportunities ' }, 'title', 1);
    expect(r?.category).toBe('IEEE opportunities');
    expect(createArchiveSearch(r ? [r] : [])('ieee')).toHaveLength(1);
    expect(await buildRecord({ ...input, category: '' }, 'title', 1)).not.toHaveProperty('category');
    expect(sanitizeRecord({ url: 'https://a.com', category: 42 }, 'x')).not.toHaveProperty('category');
  });

  it('keeps the tab group and finds pages by its name', async () => {
    const r = await buildRecord({ ...input, group: { title: 'Courses', color: 'blue' } }, 'title', 1);
    expect(r?.group).toEqual({ title: 'Courses', color: 'blue' });
    expect(createArchiveSearch(r ? [r] : [])('courses')).toHaveLength(1);
    expect(sanitizeRecord({ url: 'https://a.com', group: { title: 5 } }, 'x')).not.toHaveProperty('group');
  });

  it('keeps only the deadline date from text that is not saved', async () => {
    const text = 'Applications close on 30 November 2099. Lots of personal details here.';
    const titleOnly = await buildRecord({ ...input, text }, 'title', 1);
    expect(titleOnly?.deadline).toBe(Date.UTC(2099, 10, 30, 23, 59, 59));
    expect(titleOnly).not.toHaveProperty('text');
    expect(sanitizeRecord({ url: 'https://a.com', deadline: 'soon' }, 'x')).not.toHaveProperty('deadline');
  });
});
