import { normalizeDomain } from './classify';
import { DEFAULT_WEIGHTS, defaultPreferences } from './defaults';
import {
  CONTENT_TYPES,
  PREFERENCES_VERSION,
  type ContentType,
  type CustomCategory,
  type IndexPolicy,
  type Persona,
  type Preferences,
  type Priority,
  type ScoringWeights,
  type SiteRule,
} from './types';

/**
 * Bounds for every user-controlled value. Stored data can come from another device, an older
 * version, or manual edits, so nothing read from storage is trusted until it passes through here.
 */
export const LIMITS = {
  weight: { min: 0, max: 100 },
  staleAfterDays: { min: 1, max: 365 },
  archiveThreshold: { min: 0, max: 100 },
  /** chrome.idle rejects intervals under 15 seconds. */
  idleAfterSeconds: { min: 15, max: 3600 },
  autoArchiveEveryMinutes: { min: 15, max: 1440 },
  autoArchiveAfterHours: { min: 1, max: 720 },
  autoArchiveMaxPerRun: { min: 1, max: 200 },
  maxTopics: 100,
  maxTopicLength: 60,
  maxDomains: 500,
  maxSiteRules: 500,
  maxCategories: 50,
  maxCategoryNameLength: 40,
  maxCategoryDomains: 100,
  maxCategoryKeywords: 100,
  groupMinTabs: { min: 1, max: 20 },
  deadlineWarnDays: { min: 1, max: 60 },
} as const;

const PERSONAS: readonly Persona[] = ['student', 'developer', 'researcher', 'creator', 'general'];
const PRIORITIES: readonly Priority[] = ['high', 'normal', 'low'];
const INDEX_POLICIES: readonly IndexPolicy[] = ['full', 'title', 'never'];
const HOST_RE = /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)$/;

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function clampNumber(v: unknown, { min, max }: { min: number; max: number }, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Normalises and validates a domain. Returns '' when it isn't a plausible host name. */
export function cleanDomain(v: unknown): string {
  if (typeof v !== 'string') return '';
  const d = normalizeDomain(v);
  return HOST_RE.test(d) ? d : '';
}

function domainList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(cleanDomain).filter(Boolean))].slice(0, LIMITS.maxDomains);
}

function topicList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const topics = v
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().toLowerCase().slice(0, LIMITS.maxTopicLength))
    .filter(Boolean);
  return [...new Set(topics)].slice(0, LIMITS.maxTopics);
}

function perType<T extends string>(v: unknown, allowed: readonly T[], base: Record<ContentType, T>): Record<ContentType, T> {
  const src = isRecord(v) ? v : {};
  const out = { ...base };
  for (const type of CONTENT_TYPES) out[type] = oneOf(src[type], allowed, base[type]);
  return out;
}

function siteRules(v: unknown): SiteRule[] {
  if (!Array.isArray(v)) return [];
  const byDomain = new Map<string, ContentType>();
  for (const r of v) {
    if (!isRecord(r)) continue;
    const domain = cleanDomain(r.domain);
    if (!domain || typeof r.type !== 'string' || !(CONTENT_TYPES as readonly string[]).includes(r.type)) continue;
    byDomain.set(domain, r.type as ContentType);
  }
  return [...byDomain].slice(0, LIMITS.maxSiteRules).map(([domain, type]) => ({ domain, type }));
}

const CATEGORY_ID_RE = /^[a-z0-9-]{1,40}$/;

function customCategories(v: unknown): CustomCategory[] {
  if (!Array.isArray(v)) return [];
  const out: CustomCategory[] = [];
  const ids = new Set<string>();
  for (const [i, c] of v.slice(0, LIMITS.maxCategories).entries()) {
    if (!isRecord(c) || typeof c.name !== 'string') continue;
    const name = c.name.trim().replace(/\s+/g, ' ').slice(0, LIMITS.maxCategoryNameLength);
    if (!name) continue;
    // Ids link archived pages to their category. Repair a missing or clashing one rather than drop the category.
    let id = typeof c.id === 'string' && CATEGORY_ID_RE.test(c.id) ? c.id : `cat-${i}`;
    while (ids.has(id)) id = `${id}-x`.slice(-40);
    ids.add(id);
    out.push({
      id,
      name,
      priority: oneOf(c.priority, PRIORITIES, 'normal'),
      indexPolicy: oneOf(c.indexPolicy, INDEX_POLICIES, 'title'),
      domains: domainList(c.domains).slice(0, LIMITS.maxCategoryDomains),
      keywords: topicList(c.keywords).slice(0, LIMITS.maxCategoryKeywords),
    });
  }
  return out;
}

function weights(v: unknown): ScoringWeights {
  const src = isRecord(v) ? v : {};
  const out = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]) {
    out[key] = clampNumber(src[key], LIMITS.weight, DEFAULT_WEIGHTS[key]);
  }
  return out;
}

/**
 * Upgrades older stored shapes to the current one. Each future version adds one step here,
 * so data saved by any past release keeps working.
 */
function migrate(raw: Raw): Raw {
  // v1 is the first schema. Data with a missing version predates versioning and has the v1 shape.
  let out = raw;
  const version = typeof out.version === 'number' ? out.version : 1;
  // v1 -> v2: added captureText. Existing users never granted page access, so it starts off.
  if (version < 2) out = { ...out, captureText: false };
  // v2 -> v3: automatic archiving became real. Before, "auto" did nothing, so nobody has agreed to
  // tabs closing on their own yet. Start everyone on "ask first"; they can switch it on again.
  if (version < 3) out = { ...out, mode: 'suggest' };
  // v3 -> v4: added customCategories. Nobody has any yet.
  if (version < 4) out = { ...out, customCategories: [] };
  // v4 -> v5: tab group support (off until the user opts in) and the organise threshold.
  if (version < 5) out = { ...out, useTabGroups: false };
  // v5 -> v6: new built-in types "learning" and "jobs". The per-type maps fill them from the
  // persona's defaults on their own; nothing else changes.
  // v6 -> v7: deadline reminders, on by default (they only use dates on pages the user saved).
  if (version < 7) out = { ...out, deadlineReminders: true };
  return out;
}

/** Turns anything read from storage into valid Preferences. Never throws. */
export function sanitizePreferences(input: unknown): Preferences {
  if (!isRecord(input)) return defaultPreferences();
  const raw = migrate(input);
  const persona = oneOf(raw.persona, PERSONAS, 'general');
  const base = defaultPreferences(persona);
  return {
    version: PREFERENCES_VERSION,
    updatedAt: clampNumber(raw.updatedAt, { min: 0, max: Number.MAX_SAFE_INTEGER }, 0),
    onboarded: bool(raw.onboarded, false),
    persona,
    contentPriority: perType(raw.contentPriority, PRIORITIES, base.contentPriority),
    indexPolicy: perType(raw.indexPolicy, INDEX_POLICIES, base.indexPolicy),
    topics: topicList(raw.topics),
    alwaysImportant: domainList(raw.alwaysImportant),
    lowPriority: domainList(raw.lowPriority),
    siteRules: siteRules(raw.siteRules),
    useBuiltInSiteLists: bool(raw.useBuiltInSiteLists, base.useBuiltInSiteLists),
    weights: weights(raw.weights),
    staleAfterDays: clampNumber(raw.staleAfterDays, LIMITS.staleAfterDays, base.staleAfterDays),
    archiveThreshold: clampNumber(raw.archiveThreshold, LIMITS.archiveThreshold, base.archiveThreshold),
    mode: oneOf(raw.mode, ['suggest', 'auto'] as const, base.mode),
    trackActivity: bool(raw.trackActivity, base.trackActivity),
    idleAfterSeconds: Math.round(clampNumber(raw.idleAfterSeconds, LIMITS.idleAfterSeconds, base.idleAfterSeconds)),
    captureText: bool(raw.captureText, base.captureText),
    customCategories: customCategories(raw.customCategories),
    useTabGroups: bool(raw.useTabGroups, base.useTabGroups),
    groupMinTabs: Math.round(clampNumber(raw.groupMinTabs, LIMITS.groupMinTabs, base.groupMinTabs)),
    deadlineReminders: bool(raw.deadlineReminders, base.deadlineReminders),
    deadlineWarnDays: Math.round(clampNumber(raw.deadlineWarnDays, LIMITS.deadlineWarnDays, base.deadlineWarnDays)),
    autoArchiveEveryMinutes: Math.round(
      clampNumber(raw.autoArchiveEveryMinutes, LIMITS.autoArchiveEveryMinutes, base.autoArchiveEveryMinutes),
    ),
    autoArchiveAfterHours: Math.round(
      clampNumber(raw.autoArchiveAfterHours, LIMITS.autoArchiveAfterHours, base.autoArchiveAfterHours),
    ),
    autoArchiveMaxPerRun: Math.round(
      clampNumber(raw.autoArchiveMaxPerRun, LIMITS.autoArchiveMaxPerRun, base.autoArchiveMaxPerRun),
    ),
  };
}
