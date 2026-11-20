/**
 * "Delete all my data" and its undo. Storage areas are injected so this is unit-tested with fakes.
 */
import { deletePreferences, loadPreferences, savePreferences, type PreferenceAreas, type StorageAreaLike } from '../prefs/storage';
import type { Preferences } from '../prefs/types';
import { AUTO_RUN_KEY, readAutoRun, recordAutoRun, type AutoArchiveRun } from './autoRun';
import type { ArchiveRecord } from './record';
import { listArchive, putRecords, removeRecords, type ArchiveArea } from './store';

const ACTIVITY_KEY = 'activity';

export interface DataAreas {
  prefs: PreferenceAreas;
  /** chrome.storage.local: archive records and the automatic-run undo record. */
  local: ArchiveArea;
  /** chrome.storage.session: activity counters. */
  session: StorageAreaLike;
}

/** What was deleted, held in memory by the side panel so the user can undo. */
export interface DeletedData {
  preferences: Preferences;
  records: ArchiveRecord[];
  autoRun: AutoArchiveRun | null;
}

/**
 * Deletes everything Burrow stores: preferences (synced and local), the archive, the automatic
 * cleanup undo record, and activity counters. Returns a snapshot for undo. Activity is not part of
 * the snapshot: it is short-lived, memory-only data and simply starts again.
 */
export async function deleteAllData(areas: DataAreas): Promise<DeletedData> {
  const [preferences, records, autoRun] = await Promise.all([
    loadPreferences(areas.prefs),
    listArchive(areas.local),
    readAutoRun(areas.local),
  ]);
  await removeRecords(records.map((r) => r.id), areas.local);
  await areas.local.remove([AUTO_RUN_KEY]);
  await areas.session.remove(ACTIVITY_KEY);
  await deletePreferences(areas.prefs);
  return { preferences, records, autoRun };
}

/** Puts deleted data back. Archive first, then preferences, so the setup wizard closes last. */
export async function restoreAllData(snapshot: DeletedData, areas: DataAreas): Promise<void> {
  await putRecords(snapshot.records, areas.local);
  if (snapshot.autoRun) await recordAutoRun(snapshot.autoRun, areas.local);
  await savePreferences(snapshot.preferences, areas.prefs);
}
