/**
 * The latest automatic archive, kept so the side panel can offer "Undo". Runs that happen before
 * the user looks are merged into one, up to a cap. Older pages stay in the archive either way and
 * can still be reopened from there.
 */
import type { TabPlaces } from './plan';
import { sanitizeRecord, type ArchiveRecord } from './record';
import type { ArchiveArea, ArchiveUndo } from './store';

export const AUTO_RUN_KEY = 'autoArchiveLast';
/** Records kept for one-click undo. */
export const MAX_UNDO_RECORDS = 200;

export interface AutoArchiveRun {
  /** Epoch ms of the first run in this batch. */
  since: number;
  tabCount: number;
  undo: ArchiveUndo;
  places: TabPlaces;
}

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function records(v: unknown): ArchiveRecord[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    const rec = isRecord(r) && typeof r.id === 'string' ? sanitizeRecord(r, r.id) : null;
    return rec ? [rec] : [];
  });
}

function places(v: unknown): TabPlaces {
  const out: TabPlaces = {};
  if (!isRecord(v)) return out;
  for (const [url, p] of Object.entries(v)) {
    if (isRecord(p) && Number.isInteger(p.windowId) && Number.isInteger(p.index)) {
      out[url] = { windowId: p.windowId as number, index: Math.max(0, p.index as number) };
    }
  }
  return out;
}

/** Never trusts stored data. Returns null when there is nothing usable to undo. */
export function sanitizeAutoRun(v: unknown): AutoArchiveRun | null {
  if (!isRecord(v) || !isRecord(v.undo)) return null;
  const saved = records(v.undo.saved).slice(-MAX_UNDO_RECORDS);
  if (saved.length === 0) return null;
  const ids = new Set(saved.map((r) => r.id));
  return {
    since: Math.max(0, finite(v.since)),
    tabCount: Math.max(saved.length, Math.round(finite(v.tabCount))),
    undo: { saved, previous: records(v.undo.previous).filter((r) => ids.has(r.id)) },
    places: places(v.places),
  };
}

/** Adds a new run to the pending one. Pure. */
export function mergeAutoRun(prev: AutoArchiveRun | null, next: AutoArchiveRun): AutoArchiveRun {
  if (!prev) return next;
  // A page archived again replaces its earlier entry. Its oldest "previous" copy is what undo restores.
  const saved = [...prev.undo.saved.filter((r) => !next.undo.saved.some((n) => n.id === r.id)), ...next.undo.saved];
  const kept = saved.slice(-MAX_UNDO_RECORDS);
  const ids = new Set(kept.map((r) => r.id));
  // For a page in both runs, the state before the first run is what undo should restore.
  const inPrev = new Set(prev.undo.saved.map((r) => r.id));
  const previous = [...prev.undo.previous, ...next.undo.previous.filter((n) => !inPrev.has(n.id))].filter((r) =>
    ids.has(r.id),
  );
  return {
    since: prev.since,
    tabCount: prev.tabCount + next.tabCount,
    undo: { saved: kept, previous },
    places: { ...prev.places, ...next.places },
  };
}

export async function readAutoRun(area: ArchiveArea): Promise<AutoArchiveRun | null> {
  const got = await area.get([AUTO_RUN_KEY]);
  return sanitizeAutoRun(got[AUTO_RUN_KEY]);
}

export async function recordAutoRun(run: AutoArchiveRun, area: ArchiveArea): Promise<void> {
  await area.set({ [AUTO_RUN_KEY]: mergeAutoRun(await readAutoRun(area), run) });
}

export async function clearAutoRun(area: ArchiveArea): Promise<void> {
  await area.remove([AUTO_RUN_KEY]);
}
