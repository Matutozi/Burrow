/**
 * Importing a Burrow export file. The file is untrusted: everything goes through the same
 * sanitisers as stored data, ids are recomputed from addresses, and for each page the newest
 * copy wins, so importing an old backup can never overwrite newer archive entries.
 */
import type { Preferences } from '../prefs/types';
import { sanitizePreferences } from '../prefs/validate';
import { EXPORT_FORMAT } from './export';
import { recordId, sanitizeRecord, type ArchiveRecord } from './record';
import { listArchive, putRecords, removeRecords, type ArchiveArea } from './store';

/** Reject files larger than this before parsing. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_RECORDS = 50_000;

export interface ParsedImport {
  preferences: Preferences | null;
  records: ArchiveRecord[];
}

export type ImportError = 'tooLarge' | 'notJson' | 'notBurrow';

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function parseImport(text: string): Promise<ParsedImport | ImportError> {
  if (text.length > MAX_IMPORT_BYTES) return 'tooLarge';
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return 'notJson';
  }
  if (!isRecord(data) || data.format !== EXPORT_FORMAT) return 'notBurrow';

  const byId = new Map<string, ArchiveRecord>();
  const list = Array.isArray(data.archive) ? data.archive.slice(0, MAX_IMPORT_RECORDS) : [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.url !== 'string') continue;
    const id = await recordId(item.url);
    const rec = sanitizeRecord(item, id);
    if (!rec) continue;
    const seen = byId.get(id);
    if (!seen || rec.archivedAt > seen.archivedAt) byId.set(id, rec);
  }
  return {
    preferences: isRecord(data.preferences) ? sanitizePreferences(data.preferences) : null,
    records: [...byId.values()],
  };
}

/** The imported records that should be written: new pages, or newer copies of existing ones. */
export function recordsToWrite(current: ArchiveRecord[], incoming: ArchiveRecord[]): ArchiveRecord[] {
  const have = new Map(current.map((r) => [r.id, r.archivedAt]));
  return incoming.filter((r) => {
    const at = have.get(r.id);
    return at === undefined || r.archivedAt > at;
  });
}

export interface ImportResult {
  written: ArchiveRecord[];
  /** Records the import replaced, for undo. */
  replaced: ArchiveRecord[];
  /** Pages in the file that were already in the archive at the same or a newer version. */
  unchanged: number;
}

/** Merges imported records into the archive in one write. */
export async function importRecords(incoming: ArchiveRecord[], area: ArchiveArea): Promise<ImportResult> {
  const current = await listArchive(area);
  const written = recordsToWrite(current, incoming);
  const ids = new Set(written.map((r) => r.id));
  const replaced = current.filter((r) => ids.has(r.id));
  await putRecords(written, area);
  return { written, replaced, unchanged: incoming.length - written.length };
}

/** Reverses an import: removes the pages it added and puts back the ones it replaced. */
export async function undoImport(result: ImportResult, area: ArchiveArea): Promise<void> {
  const replacedIds = new Set(result.replaced.map((r) => r.id));
  await removeRecords(result.written.filter((r) => !replacedIds.has(r.id)).map((r) => r.id), area);
  await putRecords(result.replaced, area);
}
