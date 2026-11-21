import { useEffect, useMemo, useState } from 'preact/hooks';
import { onActivityChanged, readActivity } from '../activity/store';
import { EMPTY_ACTIVITY, type ActivityState } from '../activity/tracker';
import { runArchive, undoIfUnchanged } from '../archive/chromeApi';
import { planArchive, signalsOf } from '../archive/plan';
import { archiveBlocker } from '../archive/record';
import { canArchive, type Entitlement } from '../license/entitlement';
import { CONTENT_TYPE_LABELS, type Preferences } from '../prefs/types';
import { createScorer, type TabScore } from '../scoring/score';
import { AutoArchiveBanner } from './AutoArchiveBanner';
import { ARCHIVE_TEXT, formatArchiveResult, formatReasons, LICENSE_TEXT } from './format';
import { LicenseChip } from './License';
import type { Notify } from './Toast';

interface Props {
  prefs: Preferences;
  archiveCount: number;
  notify: Notify;
  onEditPreferences: () => void;
  onOpenArchive: () => void;
  onOpenLicense: () => void;
  entitlement: Entitlement | null;
}

interface ScoredTab {
  tab: chrome.tabs.Tab;
  result: TabScore;
}

const REFRESH_MS = 60_000;

/** Reads all open tabs and keeps them fresh as tabs change. */
function useTabs(): chrome.tabs.Tab[] {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      // Debounce bursts of tab events (e.g. restoring a session with 100 tabs).
      timer = setTimeout(async () => {
        try {
          setTabs(await chrome.tabs.query({}));
        } catch (err) {
          console.error('Burrow: could not read tabs', err);
        }
      }, 150);
    };
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (change.status === 'complete' || change.title || change.pinned !== undefined || change.audible !== undefined)
        refresh();
    };

    refresh();
    chrome.tabs.onCreated.addListener(refresh);
    chrome.tabs.onRemoved.addListener(refresh);
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    const interval = setInterval(refresh, REFRESH_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      chrome.tabs.onCreated.removeListener(refresh);
      chrome.tabs.onRemoved.removeListener(refresh);
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return tabs;
}

/** Live visit and time counters kept by the service worker. */
function useActivity(enabled: boolean): ActivityState {
  const [state, setState] = useState<ActivityState>(EMPTY_ACTIVITY);
  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_ACTIVITY);
      return;
    }
    let changedMeanwhile = false;
    const unsubscribe = onActivityChanged((next) => {
      changedMeanwhile = true;
      setState(next);
    });
    readActivity().then(
      (loaded) => !changedMeanwhile && setState(loaded),
      (err: unknown) => console.error('Burrow: could not read activity', err),
    );
    return unsubscribe;
  }, [enabled]);
  return state;
}

/** Colour bands derived from the user's threshold: clutter, the lower half of the rest, the upper half. */
function scoreClass(score: number, threshold: number): string {
  if (score < threshold) return 'low';
  if (score < threshold + (100 - threshold) / 2) return 'mid';
  return 'high';
}

async function focusTab(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (err) {
    console.error('Burrow: could not switch to tab', err);
  }
}

interface RowProps {
  item: ScoredTab;
  prefs: Preferences;
  /** Set for clutter rows that can be archived. */
  onArchive?: () => void;
  busy: boolean;
}

function Row({ item, prefs, onArchive, busy }: RowProps) {
  const { tab, result } = item;
  const candidate = onArchive !== undefined;
  const blocker = candidate ? archiveBlocker(tab.url ?? '', prefs.indexPolicy[result.contentType]) : null;
  const sensitive = blocker === 'sensitive';
  return (
    <li class="row">
      <button type="button" class="tab" onClick={() => focusTab(tab)} title={tab.url}>
        <span class={`score ${scoreClass(result.score, prefs.archiveThreshold)}`} aria-label={`Score ${result.score}`}>
          {result.score}
        </span>
        <span class="body">
          <span class="title">{tab.title || tab.url}</span>
          <span class="reason">
            <span class="type">{CONTENT_TYPE_LABELS[result.contentType]}</span>
            {result.protected && <span class="type">protected</span>}
            {sensitive && <span class="type">{ARCHIVE_TEXT.sensitive}</span>} {formatReasons(result.reasons)}
          </span>
        </span>
      </button>
      {candidate && blocker === null && (
        <button
          type="button"
          class="link"
          disabled={busy}
          onClick={onArchive}
          aria-label={`Archive ${tab.title || tab.url}`}
        >
          {ARCHIVE_TEXT.archive}
        </button>
      )}
    </li>
  );
}

/**
 * Re-reads the tabs right before archiving, so a tab that changed page, became active, or started
 * playing audio since the list was drawn is never closed by mistake.
 */
async function freshTabs(ids: number[]): Promise<chrome.tabs.Tab[]> {
  const tabs = await Promise.all(ids.map((id) => chrome.tabs.get(id).catch(() => null)));
  return tabs.filter((t): t is chrome.tabs.Tab => t !== null);
}

export function TabList({
  prefs,
  archiveCount,
  notify,
  onEditPreferences,
  onOpenArchive,
  onOpenLicense,
  entitlement,
}: Props) {
  const tabs = useTabs();
  const activity = useActivity(prefs.trackActivity);
  const scorer = useMemo(() => createScorer(prefs), [prefs]);
  const [busy, setBusy] = useState(false);

  async function archive(items: ScoredTab[]) {
    if (busy) return;
    // After the trial, archive buttons lead to the license screen instead.
    if (entitlement && !canArchive(entitlement)) {
      onOpenLicense();
      return;
    }
    setBusy(true);
    try {
      const ids = items.flatMap((i) => (i.tab.id === undefined ? [] : [i.tab.id]));
      const plan = planArchive(await freshTabs(ids), { scorer, prefs, activity, now: Date.now() });
      const result = await runArchive(plan, prefs);
      if (result.locked) {
        notify({ text: LICENSE_TEXT.lockedToast, error: true });
        onOpenLicense();
        return;
      }
      const count = (reason: string) => result.skipped.filter((s) => s.reason === reason).length;
      const archived = result.archivedTabIds.length;
      notify({
        text: formatArchiveResult(
          archived,
          result.closeFailedTabIds.length,
          count('sensitive'),
          count('notWebPage'),
          result.textDropped,
        ),
        undo:
          archived > 0
            ? async () => {
                try {
                  await undoIfUnchanged(result.undo, plan.places);
                  notify({ text: ARCHIVE_TEXT.undone });
                } catch (err) {
                  console.error('Burrow: undo failed', err);
                  notify({ text: ARCHIVE_TEXT.undoFailed, error: true });
                }
              }
            : undefined,
      });
    } catch (err) {
      console.error('Burrow: archiving failed', err);
      notify({ text: ARCHIVE_TEXT.saveFailed, error: true });
    } finally {
      setBusy(false);
    }
  }

  const { candidates, keep, total } = useMemo(() => {
    const now = Date.now();
    const scored: ScoredTab[] = tabs
      .filter((t) => !t.incognito)
      .map((tab) => ({ tab, result: scorer.score(signalsOf(tab, activity, now), now) }))
      .sort((a, b) => a.result.score - b.result.score);
    return {
      candidates: scored.filter((s) => scorer.isArchiveCandidate(s.result)),
      keep: scored.filter((s) => !scorer.isArchiveCandidate(s.result)).reverse(),
      total: scored.length,
    };
  }, [tabs, scorer, activity]);

  return (
    <main class="tablist">
      <header class="bar">
        <h1>Burrow</h1>
        <div class="buttons">
          <LicenseChip ent={entitlement} onOpen={onOpenLicense} />
          <button type="button" class="secondary small" onClick={onOpenArchive}>
            Archive ({archiveCount})
          </button>
          <button type="button" class="secondary small" onClick={onEditPreferences}>
            Preferences
          </button>
        </div>
      </header>

      <AutoArchiveBanner notify={notify} />

      <p class="summary">
        {total} open tab{total === 1 ? '' : 's'} · <strong>{candidates.length}</strong> look like clutter
      </p>

      {candidates.length > 0 && (
        <section>
          <div class="section-head">
            <h2>Clutter (score below {prefs.archiveThreshold})</h2>
            <button type="button" class="primary small" disabled={busy} onClick={() => void archive(candidates)}>
              {ARCHIVE_TEXT.archiveAll(candidates.length)}
            </button>
          </div>
          <ul class="tabs">
            {candidates.map((item) => (
              <Row key={item.tab.id} item={item} prefs={prefs} busy={busy} onArchive={() => void archive([item])} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Keeping</h2>
        <ul class="tabs">
          {keep.map((item) => (
            <Row key={item.tab.id} item={item} prefs={prefs} busy={busy} />
          ))}
        </ul>
      </section>
    </main>
  );
}
