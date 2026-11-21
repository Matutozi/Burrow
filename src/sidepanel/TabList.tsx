import { useEffect, useMemo, useState } from 'preact/hooks';
import { onActivityChanged, readActivity } from '../activity/store';
import { EMPTY_ACTIVITY, type ActivityState } from '../activity/tracker';
import { archiveTabNow, runArchive, undoIfUnchanged } from '../archive/chromeApi';
import { planArchive, signalsOf } from '../archive/plan';
import { archiveBlocker, cleanLabel, type ArchiveRecord } from '../archive/record';
import { canUse as canUseFeature, type Entitlement, type PaidFeature } from '../license/entitlement';

/** Paid features are available while the license state is still loading, so the UI doesn't flash. */
const canUse = (e: Entitlement | null, f: PaidFeature) => e === null || canUseFeature(e, f);
import { CONTENT_TYPE_LABELS, type Preferences } from '../prefs/types';
import { createScorer, type TabScore, type Verdict } from '../scoring/score';
import { AutoArchiveBanner } from './AutoArchiveBanner';
import {
  ARCHIVE_TEXT,
  CURRENT_TEXT,
  formatArchiveResult,
  formatReasons,
  GROUP_TEXT,
  VERDICT_TEXT,
  WELCOME_TEXT,
} from './format';
import { useGroups } from './groups';
import { LabelInput } from './LabelInput';
import { QuickFind } from './QuickFind';
import { Gains } from './Gains';
import { ClosingSoon } from './ClosingSoon';
import { LicenseChip } from './License';
import type { Notify } from './Toast';

interface Props {
  prefs: Preferences;
  /** Everything put away, for the search box at the top. */
  records: ArchiveRecord[];
  onSavePrefs: (prefs: Preferences) => Promise<void>;
  notify: Notify;
  onEditPreferences: () => void;
  onOpenArchive: () => void;
  onOpenLicense: () => void;
  /** Opens "Organise tabs". Called from the click, so it can ask Chrome for tab group access. */
  onOrganise: () => void;
  /** Marks the welcome as seen (sets prefs.onboarded). */
  onDismissWelcome: () => void;
  entitlement: Entitlement | null;
  /** "Save under" names already used in the archive, for suggestions. */
  savedLabels: string[];
}

interface ScoredTab {
  tab: chrome.tabs.Tab;
  result: TabScore;
  verdict: Verdict;
}

const REFRESH_MS = 60_000;

/** Reads all open tabs and keeps them fresh as tabs change. */
/** Id of the window this side panel belongs to. Each window has its own panel. */
function usePanelWindow(): number | null {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    chrome.windows.getCurrent().then(
      (w) => setId(w.id ?? null),
      (err: unknown) => console.error('Burrow: could not read the current window', err),
    );
  }, []);
  return id;
}

export function useTabs(): chrome.tabs.Tab[] {
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
      if (
        change.status === 'complete' ||
        change.title ||
        change.pinned !== undefined ||
        change.audible !== undefined ||
        change.groupId !== undefined
      )
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
export function useActivity(enabled: boolean): ActivityState {
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
function VerdictChip({ verdict, score }: { verdict: Verdict; score: number }) {
  return (
    <span class={`verdict ${verdict}`} title={VERDICT_TEXT.scoreTitle(score)}>
      {VERDICT_TEXT[verdict]}
    </span>
  );
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

function Row({ item, onArchive, busy }: RowProps) {
  const { tab, result, verdict } = item;
  const candidate = onArchive !== undefined;
  const blocker = candidate ? archiveBlocker(tab.url ?? '', result.indexPolicy) : null;
  const sensitive = blocker === 'sensitive';
  return (
    <li class="row">
      <button type="button" class="tab" onClick={() => focusTab(tab)} title={tab.url}>
        <VerdictChip verdict={verdict} score={result.score} />
        <span class="body">
          <span class="title">{tab.title || tab.url}</span>
          <span class="reason">
            <span class="type">{result.category?.name ?? result.group ?? CONTENT_TYPE_LABELS[result.contentType]}</span>
            {result.protected && <span class="type">protected</span>}
            {sensitive && <span class="type">{ARCHIVE_TEXT.sensitive}</span>} {VERDICT_TEXT.scoreTitle(result.score)} ·{' '}
            {formatReasons(result.reasons)}
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
  records,
  onSavePrefs,
  notify,
  onEditPreferences,
  onOpenArchive,
  onOpenLicense,
  onOrganise,
  onDismissWelcome,
  entitlement,
  savedLabels,
}: Props) {
  const tabs = useTabs();
  const activity = useActivity(prefs.trackActivity);
  const groups = useGroups(prefs.useTabGroups);
  const scorer = useMemo(() => createScorer(prefs), [prefs]);
  const [busy, setBusy] = useState(false);
  const [saveUnder, setSaveUnder] = useState('');

  /** @param chosen the user picked these exact rows, so the score threshold doesn't apply (protection still does). */
  async function archive(items: ScoredTab[], chosen = false) {
    if (busy) return;
    setBusy(true);
    try {
      const ids = items.flatMap((i) => (i.tab.id === undefined ? [] : [i.tab.id]));
      const label = cleanLabel(saveUnder);
      const plan = planArchive(await freshTabs(ids), {
        scorer,
        prefs,
        activity,
        groups,
        label,
        chosen,
        now: Date.now(),
      });
      const result = await runArchive(plan, prefs);
      const count = (reason: string) => result.skipped.filter((s) => s.reason === reason).length;
      const archived = result.archivedTabIds.length;
      const summary = formatArchiveResult(
        archived,
        result.closeFailedTabIds.length,
        count('sensitive'),
        count('notWebPage'),
        result.textDropped,
        label,
      );
      notify({
        text: summary,
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

  /** The tab in front in this side panel's window. */
  const windowId = usePanelWindow();
  async function archiveCurrent(tab: chrome.tabs.Tab) {
    if (busy || tab.id === undefined) return;
    setBusy(true);
    try {
      const label = cleanLabel(saveUnder);
      const r = await archiveTabNow(tab.id, prefs, label);
      if (!r.ok) {
        notify({ text: CURRENT_TEXT.notArchived[r.reason], error: true });
        return;
      }
      notify({
        text: CURRENT_TEXT.archived(r.record.title || r.record.url, label),
        undo: async () => {
          try {
            await undoIfUnchanged(r.undo, r.places);
            notify({ text: ARCHIVE_TEXT.undone });
          } catch (err) {
            console.error('Burrow: undo failed', err);
            notify({ text: ARCHIVE_TEXT.undoFailed, error: true });
          }
        },
      });
    } catch (err) {
      console.error('Burrow: archiving this tab failed', err);
      notify({ text: ARCHIVE_TEXT.saveFailed, error: true });
    } finally {
      setBusy(false);
    }
  }

  const { candidates, notSure, keep, total } = useMemo(() => {
    const now = Date.now();
    const scored: ScoredTab[] = tabs
      .filter((t) => !t.incognito)
      .map((tab) => {
        const result = scorer.score(signalsOf(tab, activity, now, groups), now);
        return { tab, result, verdict: scorer.verdict(result) };
      })
      .sort((a, b) => a.result.score - b.result.score);
    return {
      candidates: scored.filter((s) => s.verdict === 'putAway'),
      notSure: scored.filter((s) => s.verdict === 'notSure'),
      keep: scored.filter((s) => s.verdict === 'keep').reverse(),
      total: scored.length,
    };
  }, [tabs, scorer, activity, groups]);

  const current = useMemo(() => {
    const now = Date.now();
    const tab = tabs.find((t) => t.active && t.windowId === windowId && !t.incognito);
    return tab ? { tab, result: scorer.score(signalsOf(tab, activity, now, groups), now) } : null;
  }, [tabs, windowId, scorer, activity, groups]);
  const currentBlock = current
    ? current.tab.pinned
      ? 'pinned'
      : archiveBlocker(current.tab.url ?? '', current.result.indexPolicy)
    : null;

  return (
    <main class="tablist">
      <header class="bar">
        <h1>Burrow</h1>
        <div class="buttons">
          <LicenseChip ent={entitlement} onOpen={onOpenLicense} />
          <button type="button" class="secondary small" onClick={onOrganise}>
            {GROUP_TEXT.organiseButton}
          </button>
          <button type="button" class="secondary small" onClick={onOpenArchive}>
            Archive ({records.length})
          </button>
          <button type="button" class="secondary small" onClick={onEditPreferences}>
            Preferences
          </button>
        </div>
      </header>

      <QuickFind
        records={records}
        prefs={prefs}
        notify={notify}
        pageTextAllowed={canUse(entitlement, 'pageText')}
        onOpenLicense={onOpenLicense}
        onSavePrefs={onSavePrefs}
        onOpenArchive={onOpenArchive}
      >
        <AutoArchiveBanner notify={notify} />
        <ClosingSoon
          records={records}
          prefs={prefs}
          allowed={canUse(entitlement, 'deadlines')}
          notify={notify}
          onOpenLicense={onOpenLicense}
        />

        <section class={`hero${prefs.onboarded ? '' : ' first'}`}>
          {!prefs.onboarded && <p class="welcome">{WELCOME_TEXT.hello}</p>}
          <p class="hero-line">{WELCOME_TEXT.status(total, candidates.length)}</p>
          <Gains />
          {candidates.length > 0 && (
            <div class="buttons">
              {canUse(entitlement, 'organise') ? (
                <button type="button" class="primary" disabled={busy} onClick={onOrganise}>
                  {WELCOME_TEXT.preview}
                </button>
              ) : null}
              <button
                type="button"
                class={canUse(entitlement, 'organise') ? 'secondary' : 'primary'}
                disabled={busy}
                onClick={() => void archive(candidates)}
              >
                {WELCOME_TEXT.putAwayAll(candidates.length)}
              </button>
            </div>
          )}
          {!prefs.onboarded && (
            <p class="muted">
              <small>
                {WELCOME_TEXT.optional}{' '}
                <button type="button" class="link" onClick={onEditPreferences}>
                  {WELCOME_TEXT.personalise}
                </button>{' '}
                ·{' '}
                <button type="button" class="link" onClick={onDismissWelcome}>
                  {WELCOME_TEXT.dismiss}
                </button>
              </small>
            </p>
          )}
        </section>

        {current && (
          <section class="current">
            <div class="section-head">
              <h2>{CURRENT_TEXT.heading}</h2>
              {currentBlock ? (
                <small class="muted">{CURRENT_TEXT.blocked[currentBlock]}</small>
              ) : (
                <button
                  type="button"
                  class="primary small"
                  disabled={busy}
                  onClick={() => void archiveCurrent(current.tab)}
                >
                  {CURRENT_TEXT.button}
                </button>
              )}
            </div>
            <p class="current-title" title={current.tab.url}>
              <VerdictChip verdict={scorer.verdict(current.result)} score={current.result.score} />
              <span class="title">{current.tab.title || current.tab.url}</span>
            </p>
            <small class="muted">{CURRENT_TEXT.shortcut}</small>
          </section>
        )}

        {(current || candidates.length > 0) && (
          <LabelInput value={saveUnder} onChange={setSaveUnder} suggestions={savedLabels} />
        )}

        {candidates.length > 0 && (
          <section>
            <div class="section-head">
              <h2>{VERDICT_TEXT.putAwayHeading(candidates.length)}</h2>
              <button type="button" class="primary small" disabled={busy} onClick={() => void archive(candidates)}>
                {ARCHIVE_TEXT.archiveAll(candidates.length)}
              </button>
            </div>
            <ul class="tabs">
              {candidates.map((item) => (
                <Row
                  key={item.tab.id}
                  item={item}
                  prefs={prefs}
                  busy={busy}
                  onArchive={() => void archive([item], true)}
                />
              ))}
            </ul>
          </section>
        )}

        {notSure.length > 0 && (
          <section>
            <h2>{VERDICT_TEXT.notSureHeading(notSure.length)}</h2>
            <p class="muted">
              <small>{VERDICT_TEXT.notSureHelp}</small>
            </p>
            <ul class="tabs">
              {notSure.map((item) => (
                <Row
                  key={item.tab.id}
                  item={item}
                  prefs={prefs}
                  busy={busy}
                  onArchive={() => void archive([item], true)}
                />
              ))}
            </ul>
          </section>
        )}

        {keep.length > 0 && (
          <details class="keep">
            <summary>
              <h2>{VERDICT_TEXT.keepHeading(keep.length)}</h2>
            </summary>
            <ul class="tabs">
              {keep.map((item) => (
                <Row key={item.tab.id} item={item} prefs={prefs} busy={busy} />
              ))}
            </ul>
          </details>
        )}
      </QuickFind>
    </main>
  );
}
