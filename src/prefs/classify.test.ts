import { describe, expect, it } from 'vitest';
import { classify, normalizeDomain } from './classify';

describe('classify', () => {
  it.each([
    ['https://mail.google.com/mail/u/0', 'email'],
    ['https://www.paypal.com/myaccount', 'finance'],
    ['https://github.com/Matutozi/Burrow', 'code'],
    ['https://developer.mozilla.org/en-US/docs/Web', 'docs'],
    ['https://www.youtube.com/watch?v=1', 'video'],
    ['https://old.reddit.com/r/chrome', 'social'],
    ['https://www.amazon.com/dp/B000', 'shopping'],
    ['https://www.bbc.co.uk/news', 'news'],
    ['https://docs.google.com/document/d/1', 'work'],
    ['https://docs.someproject.dev/intro', 'docs'],
    ['https://example.com/blog/post-1', 'article'],
    ['https://shop.example.com/checkout/', 'shopping'],
    ['https://example.com/', 'other'],
    ['chrome://extensions', 'other'],
    ['not a url', 'other'],
  ])('%s -> %s', (url, expected) => {
    expect(classify(url)).toBe(expected);
  });
});

describe('normalizeDomain', () => {
  it.each([
    ['https://www.Example.com/path?q=1', 'example.com'],
    ['example.com', 'example.com'],
    ['  sub.example.com  ', 'sub.example.com'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});
