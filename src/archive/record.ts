/**
 * Pure archive logic: what an archived page looks like, how stored records are repaired, and how
 * they are searched. No Chrome APIs here, so every edge case is unit-tested.
 */
import { hostOf } from '../prefs/classify';
import { CONTENT_TYPES, type ContentType, type IndexPolicy } from '../prefs/types';

/** Current record shape. Bump it and add a step in `migrateRecord` when the shape changes. */
export const ARCHIVE_VERSION = 1;

export const ARCHIVE_LIMITS = {
  maxTitleLength: 500,
  maxUrlLength: 4096,
} as const;

export interface ArchiveRecord {
  v: typeof ARCHIVE_VERSION;
  /** Derived from the URL, so archiving the same page twice updates one record. */
  id: string;
  url: string;
  title: string;
  contentType: ContentType;
  /** Score when it was archived, for context in the archive list. */
  score: number;
  /** Epoch ms. */
  archivedAt: number;
  /** What was saved, following the user's index policy for this content type. */
  saved: Exclude<IndexPolicy, 'never'>;
}

/** Everything needed to archive one open tab. */
export interface ArchiveInput {
  url: string;
  title: string;
  contentType: ContentType;
  score: number;
}

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Only ordinary web pages can be archived. Browser pages (chrome://, new tab) have nothing to keep. */
export function isArchivableUrl(url: string): boolean {
  return url.length <= ARCHIVE_LIMITS.maxUrlLength && hostOf(url) !== null;
}

/** Why a tab can't be archived, or null when it can. */
export type NotArchivableReason = 'notWebPage' | 'sensitive';

export function archiveBlocker(url: string, policy: IndexPolicy): NotArchivableReason | null {
  if (!isArchivableUrl(url)) return 'notWebPage';
  // "Never save" means Burrow keeps no trace of the page, so it can't archive (and must not close) it.
  if (policy === 'never') return 'sensitive';
  return null;
}

/** Stable id for a URL: the first 96 bits of its SHA-256, as hex. */
export async function recordId(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Builds a record, or returns null if the policy or address doesn't allow saving it. */
export async function buildRecord(input: ArchiveInput, policy: IndexPolicy, now: number): Promise<ArchiveRecord | null> {
  if (archiveBlocker(input.url, policy) !== null) return null;
  return {
    v: ARCHIVE_VERSION,
    id: await recordId(input.url),
    url: input.url,
    title: input.title.trim().slice(0, ARCHIVE_LIMITS.maxTitleLength),
    contentType: input.contentType,
    score: Math.round(Math.min(100, Math.max(0, Number.isFinite(input.score) ? input.score : 0))),
    archivedAt: now,
    // Page text capture comes later. Until then a "full" policy stores the same as "title".
    saved: 'title',
  };
}

/** Upgrades older stored shapes. v1 is the first. */
function migrateRecord(raw: Raw): Raw {
  return raw;
}

/** Turns anything read from storage into a valid record, or null if it can't be repaired. Never throws. */
export function sanitizeRecord(input: unknown, id: string): ArchiveRecord | null {
  if (!isRecord(input)) return null;
  const raw = migrateRecord(input);
  if (typeof raw.url !== 'string' || !isArchivableUrl(raw.url)) return null;
  const archivedAt = typeof raw.archivedAt === 'number' && Number.isFinite(raw.archivedAt) ? raw.archivedAt : 0;
  const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? Math.round(Math.min(100, Math.max(0, raw.score))) : 0;
  const contentType =
    typeof raw.contentType === 'string' && (CONTENT_TYPES as readonly string[]).includes(raw.contentType)
      ? (raw.contentType as ContentType)
      : 'other';
  return {
    v: ARCHIVE_VERSION,
    id,
    url: raw.url,
    title: typeof raw.title === 'string' ? raw.title.slice(0, ARCHIVE_LIMITS.maxTitleLength) : '',
    contentType,
    score,
    archivedAt: Math.max(0, archivedAt),
    saved: raw.saved === 'full' ? 'full' : 'title',
  };
}

/** Newest first. */
export function sortRecords(records: ArchiveRecord[]): ArchiveRecord[] {
  return [...records].sort((a, b) => b.archivedAt - a.archivedAt || a.url.localeCompare(b.url));
}

/**
 * Simple search: every word in the query must appear in the title or address (case-insensitive).
 * Full-text search arrives with page capture.
 */
export function searchRecords(records: ArchiveRecord[], query: string): ArchiveRecord[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return records;
  return records.filter((r) => {
    const hay = `${r.title} ${r.url}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
