import { useEffect, useState } from 'preact/hooks';
import { AUTO_RUN_KEY, clearAutoRun, readAutoRun, type AutoArchiveRun } from '../archive/autoRun';
import { undoIfUnchanged } from '../archive/chromeApi';
import { AUTO_TEXT } from './format';
import type { Notify } from './Toast';

function useAutoRun(): AutoArchiveRun | null {
  const [run, setRun] = useState<AutoArchiveRun | null>(null);
  useEffect(() => {
    const reload = () =>
      readAutoRun(chrome.storage.local).then(setRun, (err: unknown) => console.error('Burrow: could not read last cleanup', err));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && AUTO_RUN_KEY in changes) void reload();
    };
    void reload();
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  return run;
}

/** Shows what automatic archiving did since the user last looked, with one-click undo. */
export function AutoArchiveBanner({ notify }: { notify: Notify }) {
  const run = useAutoRun();
  const [busy, setBusy] = useState(false);
  if (!run) return null;

  const dismiss = () => clearAutoRun(chrome.storage.local).catch((err: unknown) => console.error('Burrow: dismiss failed', err));

  const undo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const reopened = await undoIfUnchanged(run.undo, run.places);
      await clearAutoRun(chrome.storage.local);
      notify({ text: AUTO_TEXT.undone(reopened) });
    } catch (err) {
      console.error('Burrow: undo of automatic archive failed', err);
      notify({ text: AUTO_TEXT.undoFailed, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="banner" role="status">
      <span>{AUTO_TEXT.banner(run.tabCount, run.since)}</span>
      <button type="button" class="link" disabled={busy} onClick={() => void undo()}>
        Undo
      </button>
      <button type="button" class="link" onClick={() => void dismiss()}>
        {AUTO_TEXT.dismiss}
      </button>
    </div>
  );
}
