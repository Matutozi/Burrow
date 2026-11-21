import type { IndexPolicy } from '../prefs/types';
import {
  archiveBlocker,
  buildRecord,
  cleanLabel,
  sanitizeRecord,
  sortRecords,
  withoutText,
  type ArchiveInput,
  type ArchiveRecord,
  type NotArchivableReason,
} from './record';

/**
 * Archived pages live in chrome.storage.local: on this device only, never synced. Each record has
 * its own key, so writes from two side panels can't overwrite each other's lists, and archiving a
 * batch is a single write.
 */
export const RECORD_PREFIX = 'archive:';

const keyOf = (id: string) => RECORD_PREFIX + id;

/** The subset of chrome.storage.local the archive uses, so tests can pass an in-memory fake. */
export interface ArchiveArea {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

function localArea(): ArchiveArea {
  return chrome.storage.local;
}

/** Every stored record, repaired and newest first. Unrepairable entries are skipped, not deleted. */
export async function listArchive(area: ArchiveArea = localArea()): Promise<ArchiveRecord[]> {
  const all = await area.get(null);
  const records: ArchiveRecord[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(RECORD_PREFIX)) continue;
    const rec = sanitizeRecord(value, key.slice(RECORD_PREFIX.length));
    if (rec) records.push(rec);
  }
  return sortRecords(records);
}

async function readRecords(ids: string[], area: ArchiveArea): Promise<ArchiveRecord[]> {
  if (ids.length === 0) return [];
  const got = await area.get(ids.map(keyOf));
  return ids.flatMap((id) => {
    const rec = sanitizeRecord(got[keyOf(id)], id);
    return rec ? [rec] : [];
  });
}

/** Writes records in one batch. Resolves only once Chrome has stored them. */
export async function putRecords(records: ArchiveRecord[], area: ArchiveArea = localArea()): Promise<void> {
  if (records.length === 0) return;
  await area.set(Object.fromEntries(records.map((r) => [keyOf(r.id), r])));
}

/**
 * Saves pages under a new name (or no name, for ''). Returns the records as they were, for undo.
 * Nothing else about the pages changes.
 */
export async function relabelRecords(
  records: ArchiveRecord[],
  label: string,
  area: ArchiveArea = localArea(),
): Promise<ArchiveRecord[]> {
  const name = cleanLabel(label);
  const next = records.map(({ label: _old, ...rest }) => (name ? { ...rest, label: name } : rest));
  await putRecords(next, area);
  return records;
}

/** Deletes records and returns what was there, so the caller can offer undo. */
export async function removeRecords(ids: string[], area: ArchiveArea = localArea()): Promise<ArchiveRecord[]> {
  const before = await readRecords(ids, area);
  if (before.length > 0) await area.remove(before.map((r) => keyOf(r.id)));
  return before;
}

export interface ArchiveRequest {
  tabId: number;
  input: ArchiveInput;
  policy: IndexPolicy;
}

/** Everything needed to put things back exactly as they were. */
export interface ArchiveUndo {
  /** Records written by this archive. */
  saved: ArchiveRecord[];
  /** Records that existed before under the same ids (the page had been archived earlier). */
  previous: ArchiveRecord[];
}

export interface ArchiveResult {
  /** Tabs whose record was saved. */
  archivedTabIds: number[];
  /** Saved tabs Chrome could not close (they stay open; their records are kept). */
  closeFailedTabIds: number[];
  skipped: { tabId: number; reason: NotArchivableReason }[];
  /** Storage was too full for page text, so these pages were saved with their title only. */
  textDropped: boolean;
  undo: ArchiveUndo;
}

export interface ArchiveDeps {
  area?: ArchiveArea;
  /** Closes tabs. Returns the ids it could not close. */
  closeTabs: (tabIds: number[]) => Promise<number[]>;
  now: number;
}

/**
 * Archives tabs safely: records are written first, and tabs are closed only after that write has
 * succeeded. If the write fails, this throws and no tab is closed.
 */
export async function archiveTabs(requests: ArchiveRequest[], deps: ArchiveDeps): Promise<ArchiveResult> {
  const area = deps.area ?? localArea();
  const skipped: ArchiveResult['skipped'] = [];
  const toSave: { tabId: number; record: ArchiveRecord }[] = [];

  for (const req of requests) {
    const reason = archiveBlocker(req.input.url, req.policy);
    const record = reason === null ? await buildRecord(req.input, req.policy, deps.now) : null;
    if (record) toSave.push({ tabId: req.tabId, record });
    else skipped.push({ tabId: req.tabId, reason: reason ?? 'notWebPage' });
  }

  // Two tabs with the same address share one record.
  let saved = [...new Map(toSave.map((s) => [s.record.id, s.record])).values()];
  const previous = await readRecords(
    saved.map((r) => r.id),
    area,
  );
  let textDropped = false;
  try {
    await putRecords(saved, area);
  } catch (err) {
    // Usually the storage quota. Page text is the bulk of a record, so retry with titles only.
    // If that fails too, this throws and no tab is closed.
    if (!saved.some((r) => r.text)) throw err;
    saved = saved.map(withoutText);
    await putRecords(saved, area);
    textDropped = true;
  }

  const archivedTabIds = toSave.map((s) => s.tabId);
  const closeFailedTabIds = archivedTabIds.length > 0 ? await deps.closeTabs(archivedTabIds) : [];
  return { archivedTabIds, closeFailedTabIds, skipped, textDropped, undo: { saved, previous } };
}

/**
 * Narrows an undo to what is still true. A page the user has since reopened or deleted, or that was
 * archived again later, is left alone, so undo can't duplicate tabs or bring back deleted data.
 */
export function reconcileUndo(undo: ArchiveUndo, current: ArchiveRecord[]): ArchiveUndo {
  const now = new Map(current.map((r) => [r.id, r.archivedAt]));
  const saved = undo.saved.filter((r) => now.get(r.id) === r.archivedAt);
  const ids = new Set(saved.map((r) => r.id));
  return { saved, previous: undo.previous.filter((r) => ids.has(r.id)) };
}

/**
 * Reverses an archive: reopens the pages first, then puts the records back as they were. If
 * reopening fails, this throws and the records are left untouched, so nothing is lost.
 */
export async function undoArchive(
  undo: ArchiveUndo,
  openPages: (records: ArchiveRecord[]) => Promise<void>,
  area: ArchiveArea = localArea(),
): Promise<void> {
  await openPages(undo.saved);
  const hadBefore = new Set(undo.previous.map((r) => r.id));
  const created = undo.saved.filter((r) => !hadBefore.has(r.id)).map((r) => keyOf(r.id));
  if (created.length > 0) await area.remove(created);
  await putRecords(undo.previous, area);
}

/** Reopens archived pages, then removes them from the archive. Returns the removed records. */
export async function restoreRecords(
  records: ArchiveRecord[],
  openPages: (records: ArchiveRecord[]) => Promise<void>,
  area: ArchiveArea = localArea(),
): Promise<ArchiveRecord[]> {
  await openPages(records);
  return removeRecords(
    records.map((r) => r.id),
    area,
  );
}

/** Calls back whenever any archive record is added, changed or removed. */
export function onArchiveChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName === 'local' && Object.keys(changes).some((k) => k.startsWith(RECORD_PREFIX))) cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
