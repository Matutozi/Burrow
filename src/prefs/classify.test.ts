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

describe('learning, jobs and coding practice', () => {
  it.each([
    ['https://leetcode.com/problems/maximum-subarray-min-product/description/', '', 'code'],
    ['https://neetcode.io/practice/practice/neetcode150', '', 'code'],
    ['https://anthropic.skilljar.com/claude-code-in-action', '', 'learning'],
    ['https://www.skills.google/paths/3135/course_templates/1341', '', 'learning'],
    ['https://learn.chipmango.com/dashboard/x', '', 'learning'],
    ['https://canvas.myuni.edu/courses/123', '', 'learning'],
    ['https://blackrock.tal.net/vx/candidate', '', 'jobs'],
    ['https://apply.internships.cispa.de/', '', 'jobs'],
    ['https://jobs.fao.org/careersection/x', '', 'jobs'],
    ['https://example.org/careers/engineering', '', 'jobs'],
    // Unknown sites fall back to the title.
    ['https://mercatus.tfaforms.net/12', 'Emergent Ventures Grant Application', 'jobs'],
    ['https://ieeesystemscouncil.org/x', 'IEEE Systems Council Engineering Undergraduate Scholarship', 'jobs'],
    ['https://example.com/x', 'Lecture 4: Dynamic programming', 'learning'],
    ['https://example.com/x', "Do Things that Don't Scale", 'other'],
  ])('%s (%s) -> %s', (url, title, expected) => {
    expect(classify(url, {}, title)).toBe(expected);
  });

  it('never calls a page sensitive from its title alone, and respects built-ins being off', () => {
    expect(classify('https://example.com', {}, 'My bank statement email')).toBe('other');
    expect(classify('https://example.com', { useBuiltIns: false }, 'Internship')).toBe('other');
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
