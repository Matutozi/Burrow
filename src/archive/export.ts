import type { Preferences } from '../prefs/types';
import type { ArchiveRecord } from './record';

export const EXPORT_FORMAT = 'burrow-export';
export const EXPORT_VERSION = 1;

export interface BurrowExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  preferences: Preferences;
  archive: ArchiveRecord[];
}

/**
 * Everything Burrow keeps about the user that lasts beyond this session, in one portable file
 * (GDPR / NDPA / CCPA data portability). Activity counters are memory-only and not included.
 */
export function buildExport(preferences: Preferences, archive: ArchiveRecord[], now: number): BurrowExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    preferences,
    archive,
  };
}

export function exportFileName(now: number): string {
  return `burrow-export-${new Date(now).toISOString().slice(0, 10)}.json`;
}
