import { useEffect, useState } from 'preact/hooks';
import { EMPTY_STATS, estimatedMbFreed, readStats, STATS_KEY, type Stats } from '../archive/stats';
import { formatDate, GAINS_TEXT } from './format';

function useStats(): Stats {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  useEffect(() => {
    const reload = () =>
      readStats(chrome.storage.local).then(setStats, (err: unknown) => console.error('Burrow: could not read stats', err));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && STATS_KEY in changes) void reload();
    };
    void reload();
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  return stats;
}

/** "Burrow has put away 214 tabs since 3 Nov · about 10.5 GB of memory freed". Hidden until the first one. */
export function Gains() {
  const stats = useStats();
  if (stats.tabsPutAway === 0) return null;
  return <p class="gains">{GAINS_TEXT.line(stats.tabsPutAway, formatDate(stats.since), estimatedMbFreed(stats))}</p>;
}
