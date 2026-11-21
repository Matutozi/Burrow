import type { ContentType, SiteRule } from './types';

/** Built-in defaults: known domains per content type. Users can override or switch these off. */
export const BUILT_IN_DOMAINS: Partial<Record<ContentType, string[]>> = {
  email: ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com', 'proton.me', 'mail.proton.me'],
  finance: [
    'paypal.com',
    'chase.com',
    'bankofamerica.com',
    'wellsfargo.com',
    'revolut.com',
    'wise.com',
    'stripe.com',
    'coinbase.com',
    'binance.com',
  ],
  health: ['mychart.org', 'webmd.com', 'mayoclinic.org', 'nhs.uk', 'healthline.com'],
  code: [
    'github.com',
    'gitlab.com',
    'bitbucket.org',
    'codepen.io',
    'codesandbox.io',
    'stackblitz.com',
    'replit.com',
    'npmjs.com',
    'pypi.org',
    'dev.azure.com',
    'vercel.com',
    'netlify.com',
    'huggingface.co',
    // Coding practice
    'leetcode.com',
    'neetcode.io',
    'hackerrank.com',
    'codeforces.com',
    'codewars.com',
    'codechef.com',
    'geeksforgeeks.org',
    'exercism.org',
    'atcoder.jp',
    'kaggle.com',
  ],
  learning: [
    'coursera.org',
    'edx.org',
    'udemy.com',
    'udacity.com',
    'khanacademy.org',
    'skillshare.com',
    'pluralsight.com',
    'codecademy.com',
    'freecodecamp.org',
    'datacamp.com',
    'skilljar.com',
    'skills.google',
    'cloudskillsboost.google',
    'alison.com',
    'futurelearn.com',
    'brilliant.org',
    'classcentral.com',
    'deeplearning.ai',
    'fast.ai',
    'learn.chipmango.com',
    'scrimba.com',
    'educative.io',
    'w3schools.com',
    'theodinproject.com',
    'mit.edu',
  ],
  jobs: [
    'indeed.com',
    'glassdoor.com',
    'wellfound.com',
    'myworkdayjobs.com',
    'greenhouse.io',
    'lever.co',
    'ashbyhq.com',
    'smartrecruiters.com',
    'workable.com',
    'jobberman.com',
    'tal.net',
    'jobstoapply.com',
    'opportunitydesk.org',
    'opportunitiesforafricans.com',
    'scholars4dev.com',
    'devpost.com',
    'lablab.ai',
    'mlh.io',
    'internshala.com',
    'handshake.com',
    'joinhandshake.com',
    'ycombinator.com',
  ],
  docs: [
    'developer.mozilla.org',
    'docs.python.org',
    'learn.microsoft.com',
    'developer.chrome.com',
    'readthedocs.io',
    'wikipedia.org',
    'stackoverflow.com',
    'stackexchange.com',
    'devdocs.io',
  ],
  video: ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'netflix.com', 'tiktok.com'],
  social: [
    'x.com',
    'twitter.com',
    'facebook.com',
    'instagram.com',
    'reddit.com',
    'linkedin.com',
    'threads.net',
    'bsky.app',
    'pinterest.com',
    'discord.com',
  ],
  shopping: [
    'amazon.com',
    'ebay.com',
    'aliexpress.com',
    'etsy.com',
    'walmart.com',
    'jumia.com.ng',
    'jiji.ng',
    'temu.com',
    'shein.com',
  ],
  news: [
    'nytimes.com',
    'bbc.com',
    'bbc.co.uk',
    'cnn.com',
    'theguardian.com',
    'reuters.com',
    'apnews.com',
    'aljazeera.com',
    'punchng.com',
    'news.ycombinator.com',
  ],
  article: ['medium.com', 'substack.com', 'dev.to', 'hashnode.dev', 'arxiv.org', 'scholar.google.com'],
  work: [
    'docs.google.com',
    'drive.google.com',
    'notion.so',
    'slack.com',
    'app.slack.com',
    'atlassian.net',
    'linear.app',
    'figma.com',
    'trello.com',
    'asana.com',
    'calendar.google.com',
    'teams.microsoft.com',
  ],
};

/** Built-in fallback hints when the domain is unknown. Checked against host + path. */
export const BUILT_IN_PATTERNS: [RegExp, ContentType][] = [
  [
    /(^|\.)(jobs|careers|apply|internships?|recruit(ing)?)\.|\/(jobs?|careers?|internships?|vacanc(y|ies)|opportunit(y|ies)|fellowships?|scholarships?)(\/|$)/i,
    'jobs',
  ],
  [/(^|\.)(canvas|moodle|lms|elearning|academy)\.|\/(courses?|lessons?|lectures?|learn|tutorials?)(\/|$)/i, 'learning'],
  [/(^|\.)docs?\.|\/docs?(\/|$)|\/reference\/|\/api\//i, 'docs'],
  [/\/(blog|posts?|articles?)\//i, 'article'],
  [/\/(cart|checkout|product|item|dp)\//i, 'shopping'],
  [/(^|\.)(bank|banking)\.|\/(banking|account\/statements)/i, 'finance'],
  [/(^|\.)mail\./i, 'email'],
  [/\/(watch|video)s?(\/|\?|$)/i, 'video'],
];

/**
 * Last-resort hints from the tab's title, for sites the lists don't know. Whole words only, and
 * never for sensitive types: a title alone is not enough to call a page email, banking or health.
 */
export const BUILT_IN_TITLE_PATTERNS: [RegExp, ContentType][] = [
  [
    /\b(internships?|scholarships?|fellowships?|vacanc(y|ies)|job description|careers?|hiring|call for (applications|papers|proposals)|apply now|application form|hackathons?|grants?|opportunit(y|ies))\b/i,
    'jobs',
  ],
  [
    /\b(courses?|lessons?|lectures?|tutorials?|bootcamp|certifications?|syllabus|modules?|learning path|quiz)\b/i,
    'learning',
  ],
  [/\b(documentation|api reference|reference guide|docs)\b/i, 'docs'],
  [/\b(leetcode|coding interview|pull requests?|merge requests?|repository|repo)\b/i, 'code'],
];

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** True when host is the domain itself or one of its subdomains. */
export function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

/** Turns user input like "https://www.Example.com/path" into "example.com". */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  const withScheme = /^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  return hostOf(withScheme) ?? '';
}

export interface ClassifyOptions {
  /** User rules, checked first. The most specific (longest) matching domain wins. */
  siteRules?: SiteRule[];
  /** When false, only user rules are used. */
  useBuiltIns?: boolean;
}

/** Classifies a page by its address, falling back to its title for unknown sites. */
export type Classifier = (url: string, title?: string) => ContentType;

const SENSITIVE: ReadonlySet<ContentType> = new Set(['email', 'finance', 'health']);

/** domain -> type for the built-in lists. If a domain appears twice, the sensitive type wins. */
const BUILT_IN_MAP: ReadonlyMap<string, ContentType> = (() => {
  const map = new Map<string, ContentType>();
  for (const [type, domains] of Object.entries(BUILT_IN_DOMAINS) as [ContentType, string[]][]) {
    for (const d of domains) {
      const existing = map.get(d);
      if (!existing || !SENSITIVE.has(existing)) map.set(d, type);
    }
  }
  return map;
})();

/** Looks up host, then each parent domain, so the most specific entry wins in O(labels). */
function lookup(map: ReadonlyMap<string, ContentType>, host: string): ContentType | undefined {
  let h = host;
  for (;;) {
    const hit = map.get(h);
    if (hit) return hit;
    const dot = h.indexOf('.');
    if (dot < 0) return undefined;
    h = h.slice(dot + 1);
  }
}

/** Builds a fast classifier once per preference change. */
export function createClassifier(options: ClassifyOptions = {}): Classifier {
  const userMap = new Map((options.siteRules ?? []).map((r) => [r.domain, r.type] as const));
  const useBuiltIns = options.useBuiltIns !== false;
  return (url, title = '') => {
    const host = hostOf(url);
    if (!host) return 'other';
    const user = lookup(userMap, host);
    if (user) return user;
    if (!useBuiltIns) return 'other';
    const builtIn = lookup(BUILT_IN_MAP, host);
    if (builtIn) return builtIn;
    let path = '';
    try {
      path = new URL(url).pathname;
    } catch {
      /* hostOf already validated the URL */
    }
    for (const [re, type] of BUILT_IN_PATTERNS) {
      if (re.test(host + path)) return type;
    }
    for (const [re, type] of BUILT_IN_TITLE_PATTERNS) {
      if (re.test(title)) return type;
    }
    return 'other';
  };
}

/** One-off convenience. Prefer createClassifier when classifying many URLs. */
export function classify(url: string, options: ClassifyOptions = {}, title?: string): ContentType {
  return createClassifier(options)(url, title);
}
