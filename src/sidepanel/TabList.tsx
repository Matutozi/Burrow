import { useEffect, useMemo, useState } from 'preact/hooks';
import { CONTENT_TYPE_LABELS, type Preferences } from '../prefs/types';
import { isArchiveCandidate, scoreTab, type TabScore } from '../scoring/score';

interface Props {
  prefs: Preferences;
  onEditPreferences: () => void;
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
      if (change.status === 'complete' || change.title || change.pinned !== undefined || change.audible !== undefined) refresh();
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

function scoreClass(score: number, prefs: Preferences): string {
  if (score < prefs.archiveThreshold) return 'low';
  if (score < 60) return 'mid';
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

function Row({ item, prefs }: { item: ScoredTab; prefs: Preferences }) {
  const { tab, result } = item;
  const reason = result.reasons.map((r) => (r.points ? `${r.label} (${r.points > 0 ? '+' : ''}${r.points})` : r.label)).join(' · ');
  return (
    <li>
      <button type="button" class="tab" onClick={() => focusTab(tab)} title={tab.url}>
        <span class={`score ${scoreClass(result.score, prefs)}`} aria-label={`Score ${result.score}`}>
          {result.score}
        </span>
        <span class="body">
          <span class="title">{tab.title || tab.url}</span>
          <span class="reason">
            <span class="type">{CONTENT_TYPE_LABELS[result.contentType]}</span>
            {result.protected && <span class="type">protected</span>} {reason}
          </span>
        </span>
      </button>
    </li>
  );
}

export function TabList({ prefs, onEditPreferences }: Props) {
  const tabs = useTabs();

  const { candidates, keep } = useMemo(() => {
    const now = Date.now();
    const scored: ScoredTab[] = tabs
      .filter((t) => !t.incognito)
      .map((tab) => ({
        tab,
        result: scoreTab(
          {
            url: tab.url ?? '',
            title: tab.title ?? '',
            lastAccessed: tab.lastAccessed ?? now,
            pinned: tab.pinned,
            audible: tab.audible ?? false,
            active: tab.active,
          },
          prefs,
          now,
        ),
      }))
      .sort((a, b) => a.result.score - b.result.score);
    return {
      candidates: scored.filter((s) => isArchiveCandidate(s.result, prefs)),
      keep: scored.filter((s) => !isArchiveCandidate(s.result, prefs)).reverse(),
    };
  }, [tabs, prefs]);

  return (
    <main class="tablist">
      <header class="bar">
        <h1>Burrow</h1>
        <button type="button" class="secondary small" onClick={onEditPreferences}>
          Preferences
        </button>
      </header>

      <p class="summary">
        {tabs.length} open tab{tabs.length === 1 ? '' : 's'} · <strong>{candidates.length}</strong> look like clutter
      </p>

      {candidates.length > 0 && (
        <section>
          <h2>Clutter (score below {prefs.archiveThreshold})</h2>
          <ul class="tabs">
            {candidates.map((item) => (
              <Row key={item.tab.id} item={item} prefs={prefs} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Keeping</h2>
        <ul class="tabs">
          {keep.map((item) => (
            <Row key={item.tab.id} item={item} prefs={prefs} />
          ))}
        </ul>
      </section>
    </main>
  );
}
