// Burrow service worker: event wiring only. It keeps no state in memory (Chrome stops idle
// workers at any time) and makes no network requests.
import { createActivityStore } from '../activity/store';
import { focusTab, pruneTabs, removeTab, replaceTab } from '../activity/tracker';
import { loadPreferences, onPreferencesChanged } from '../prefs/storage';
import type { Preferences } from '../prefs/types';

const activity = createActivityStore();

function logError(context: string) {
  return (err: unknown) => console.error(`Burrow: ${context}`, err);
}

/** The tab the user is looking at, or null if Chrome is unfocused, the user is idle, or the screen is locked. */
async function focusedTabId(prefs: Preferences): Promise<number | null> {
  if ((await chrome.idle.queryState(prefs.idleAfterSeconds)) !== 'active') return null;
  const win = await chrome.windows.getLastFocused();
  if (!win.focused || win.incognito || win.id === undefined) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab?.id ?? null;
}

/** Re-checks what the user is looking at and updates the counters. */
async function refreshFocus(): Promise<void> {
  await activity.update(async (state) => {
    const prefs = await loadPreferences();
    if (!prefs.trackActivity) return state;
    return focusTab(state, await focusedTabId(prefs), Date.now());
  });
}

async function applySettings(prefs: Preferences): Promise<void> {
  chrome.idle.setDetectionInterval(prefs.idleAfterSeconds);
  if (!prefs.trackActivity) {
    await activity.clear();
    return;
  }
  const open = await chrome.tabs.query({});
  await activity.update((s) => pruneTabs(s, open.flatMap((t) => (t.id === undefined ? [] : [t.id]))));
  await refreshFocus();
}

async function init(): Promise<void> {
  // Session data is for extension pages only, never content scripts. This is the default; set it explicitly.
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await applySettings(await loadPreferences());
}

// Listeners must be registered synchronously at the top level so Chrome can wake the worker for them.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(logError('could not set side panel behavior'));

chrome.runtime.onInstalled.addListener(() => void init().catch(logError('init failed')));
chrome.runtime.onStartup.addListener(() => void init().catch(logError('init failed')));

chrome.tabs.onActivated.addListener(() => void refreshFocus().catch(logError('focus update failed')));
chrome.windows.onFocusChanged.addListener(() => void refreshFocus().catch(logError('focus update failed')));
chrome.idle.onStateChanged.addListener(() => void refreshFocus().catch(logError('idle update failed')));

chrome.tabs.onRemoved.addListener((tabId) => {
  void activity.update((s) => removeTab(s, tabId, Date.now())).catch(logError('tab removal failed'));
});
chrome.tabs.onReplaced.addListener((addedId, removedId) => {
  void activity.update((s) => replaceTab(s, addedId, removedId)).catch(logError('tab replace failed'));
});

onPreferencesChanged((prefs) => void applySettings(prefs).catch(logError('applying settings failed')));

// Every time Chrome wakes this worker, re-apply the idle timeout in case it was reset.
loadPreferences()
  .then((prefs) => chrome.idle.setDetectionInterval(prefs.idleAfterSeconds))
  .catch(logError('could not load preferences'));
