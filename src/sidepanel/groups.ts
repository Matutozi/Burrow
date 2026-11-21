import { useEffect, useState } from 'preact/hooks';
import { readGroups } from '../groups/chromeGroups';
import type { GroupMap } from '../groups/info';

const EMPTY: GroupMap = new Map();

/** Open tab groups, kept fresh while tab group support is on. Empty when off or not permitted. */
export function useGroups(enabled: boolean): GroupMap {
  const [groups, setGroups] = useState<GroupMap>(EMPTY);
  useEffect(() => {
    if (!enabled) {
      setGroups(EMPTY);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        readGroups().then(setGroups, (err: unknown) => console.error('Burrow: could not read tab groups', err));
      }, 150);
    };
    reload();
    // The tabGroups API only exists once the permission is granted.
    const events =
      typeof chrome.tabGroups === 'undefined'
        ? []
        : [chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved];
    for (const e of events) e.addListener(reload);
    chrome.permissions.onAdded.addListener(reload);
    return () => {
      clearTimeout(timer);
      for (const e of events) e.removeListener(reload);
      chrome.permissions.onAdded.removeListener(reload);
    };
  }, [enabled]);
  return groups;
}
