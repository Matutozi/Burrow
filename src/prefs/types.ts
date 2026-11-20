/** Kinds of pages Burrow recognises. Each one gets a priority and an index policy. */
export const CONTENT_TYPES = [
  'docs',
  'article',
  'video',
  'code',
  'work',
  'news',
  'social',
  'shopping',
  'email',
  'finance',
  'health',
  'other',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  docs: 'Docs & references',
  article: 'Articles & blogs',
  video: 'Videos',
  code: 'Code & repos',
  work: 'Work apps',
  news: 'News',
  social: 'Social media',
  shopping: 'Shopping',
  email: 'Email',
  finance: 'Banking & finance',
  health: 'Health',
  other: 'Everything else',
};

/** How much the user cares about a content type. Shifts the tab score. */
export type Priority = 'high' | 'normal' | 'low';

/** What Burrow may store when a page is archived. */
export type IndexPolicy = 'full' | 'title' | 'never';

export type Persona = 'student' | 'developer' | 'researcher' | 'creator' | 'general';

export type ArchiveMode = 'suggest' | 'auto';

/** Every number the scorer uses. All user-editable. */
export interface ScoringWeights {
  /** Max points for a recently used tab. */
  recencyMax: number;
  /** Max points from visits and time on page. Half comes from each. */
  activityMax: number;
  /** Visits needed to earn the full visits half of the activity points. */
  activityFullVisits: number;
  /** Minutes on a tab needed to earn the full time half of the activity points. */
  activityFullMinutes: number;
  /** Points added for high-priority and removed for low-priority content. */
  priorityPoints: number;
  /** Points added when a tab matches one of the user's topics. */
  topicPoints: number;
  /** Points removed for sites on the low-priority list. */
  lowPrioritySitePoints: number;
}

/** User override: "this site is this kind of content". Beats the built-in lists. */
export interface SiteRule {
  domain: string;
  type: ContentType;
}

/** Current schema version. Bump it and add a migration in validate.ts when the shape changes. */
export const PREFERENCES_VERSION = 3;

export interface Preferences {
  version: typeof PREFERENCES_VERSION;
  /** Epoch ms of the last save. Newest copy wins when sync and local disagree. */
  updatedAt: number;
  onboarded: boolean;
  persona: Persona;
  contentPriority: Record<ContentType, Priority>;
  indexPolicy: Record<ContentType, IndexPolicy>;
  /** Lowercase keywords. Tabs whose title or URL mention one get a boost. */
  topics: string[];
  /** Domains that are always important: scored 100 and never archived. */
  alwaysImportant: string[];
  /** Domains the user considers clutter. */
  lowPriority: string[];
  /** User-defined site categories, checked before the built-in lists. */
  siteRules: SiteRule[];
  /** Use Burrow's built-in site lists when no user rule matches. */
  useBuiltInSiteLists: boolean;
  weights: ScoringWeights;
  /** After this many days untouched a tab counts as stale. */
  staleAfterDays: number;
  /** Tabs scoring below this are archive candidates. */
  archiveThreshold: number;
  mode: ArchiveMode;
  /** Let Burrow measure visits and time on each tab. Data stays in memory and is cleared when Chrome closes. */
  trackActivity: boolean;
  /** Stop counting time on a tab after this many seconds without keyboard or mouse input. */
  idleAfterSeconds: number;
  /**
   * Save the readable text of pages whose index policy is 'full' when archiving them. Needs the
   * optional `scripting` and host permissions, which the user grants when turning this on. (v2)
   */
  captureText: boolean;
  /** Automatic mode: minutes between checks. (v3) */
  autoArchiveEveryMinutes: number;
  /** Automatic mode: only tabs untouched for at least this many hours are archived. (v3) */
  autoArchiveAfterHours: number;
  /** Automatic mode: most tabs archived in one check, so a bad setting can't close everything at once. (v3) */
  autoArchiveMaxPerRun: number;
}
