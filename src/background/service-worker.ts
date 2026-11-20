// Burrow service worker: event wiring only. It keeps no state in memory (Chrome stops idle
// workers at any time) and makes no network requests.
import { createActivityStore, readActivity } from '../activity/store';
import { EMPTY_ACTIVITY, focusTab, pruneTabs, removeTab, replaceTab } from '../activity/tracker';
import { recordAutoRun } from '../archive/autoRun';
import { runArchive } from '../archive/chromeApi';
import { planArchive } from '../archive/plan';
import { loadPreferences, onPreferencesChanged } from '../prefs/storage';
import type { Preferences } from '../prefs/types';
import { createScorer } from '../scoring/score';

const AUTO_ARCHIVE_ALARM = 'burrow-auto-archive';

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

/** The alarms API exists only once the user has allowed it (by choosing automatic mode). */
function alarmsAvailable(): boolean {
  return typeof chrome.alarms !== 'undefined';
}

/** Schedules or cancels automatic archiving to match the preferences. Leaves a matching schedule alone. */
async function syncAutoArchiveAlarm(prefs: Preferences): Promise<void> {
  if (!alarmsAvailable()) return;
  if (prefs.mode !== 'auto') {
    await chrome.alarms.clear(AUTO_ARCHIVE_ALARM);
    return;
  }
  const existing = await chrome.alarms.get(AUTO_ARCHIVE_ALARM);
  if (existing?.periodInMinutes === prefs.autoArchiveEveryMinutes) return;
  await chrome.alarms.create(AUTO_ARCHIVE_ALARM, {
    delayInMinutes: prefs.autoArchiveEveryMinutes,
    periodInMinutes: prefs.autoArchiveEveryMinutes,
  });
}

/** One automatic cleanup. Everything is re-read from storage and Chrome, since the worker keeps no state. */
async function autoArchive(): Promise<void> {
  const prefs = await loadPreferences();
  if (prefs.mode !== 'auto') return;
  const now = Date.now();
  const [tabs, activity] = await Promise.all([
    chrome.tabs.query({}),
    prefs.trackActivity ? readActivity() : Promise.resolve(EMPTY_ACTIVITY),
  ]);
  const plan = planArchive(tabs, { scorer: createScorer(prefs), prefs, activity, now, auto: true });
  if (plan.requests.length === 0) return;
  const result = await runArchive(plan, prefs);
  if (result.undo.saved.length === 0) return;
  await recordAutoRun(
    { since: now, tabCount: result.archivedTabIds.length, undo: result.undo, places: plan.places },
    chrome.storage.local,
  );
}

// Only tracks whether this worker instance registered its listener; it's not user state.
let alarmListenerAdded = false;
function listenForAlarms(): void {
  if (alarmListenerAdded || !alarmsAvailable()) return;
  alarmListenerAdded = true;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_ARCHIVE_ALARM) void autoArchive().catch(logError('automatic archiving failed'));
  });
}

async function applySettings(prefs: Preferences): Promise<void> {
  chrome.idle.setDetectionInterval(prefs.idleAfterSeconds);
  await syncAutoArchiveAlarm(prefs).catch(logError('could not schedule automatic archiving'));
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
listenForAlarms();
chrome.permissions.onAdded.addListener((perms) => {
  if (!perms.permissions?.includes('alarms')) return;
  // Granted while this worker is running: start listening now and schedule right away.
  listenForAlarms();
  void loadPreferences()
    .then(syncAutoArchiveAlarm)
    .catch(logError('could not schedule automatic archiving'));
});
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
