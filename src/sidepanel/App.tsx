import { useEffect, useState } from 'preact/hooks';
import { loadPreferences, onPreferencesChanged, savePreferences } from '../prefs/storage';
import type { Preferences } from '../prefs/types';
import { ArchiveView, useArchive } from './Archive';
import { Onboarding } from './Onboarding';
import { TabList } from './TabList';
import { Toast, type ToastMessage } from './Toast';

export function App() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<'tabs' | 'archive'>('tabs');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const records = useArchive();

  useEffect(() => {
    let changedMeanwhile = false;
    const unsubscribe = onPreferencesChanged((next) => {
      changedMeanwhile = true;
      setPrefs(next);
    });
    loadPreferences().then(
      // A change event that arrived first is newer than this initial read.
      (loaded) => !changedMeanwhile && setPrefs(loaded),
      () => setLoadError(true),
    );
    return unsubscribe;
  }, []);

  if (loadError) return <p class="error">Could not load your settings. Close and reopen the side panel to retry.</p>;
  if (!prefs) return null;

  if (!prefs.onboarded || editing) {
    return (
      <Onboarding
        initial={prefs}
        onDone={async (next) => {
          // Throws on failure. Onboarding stays open and offers a retry.
          setPrefs(await savePreferences({ ...next, onboarded: true }));
          setEditing(false);
        }}
        onCancel={prefs.onboarded ? () => setEditing(false) : undefined}
      />
    );
  }

  return (
    <>
      {view === 'archive' ? (
        <ArchiveView prefs={prefs} records={records} notify={setToast} onBack={() => setView('tabs')} />
      ) : (
        <TabList
          prefs={prefs}
          archiveCount={records.length}
          notify={setToast}
          onEditPreferences={() => setEditing(true)}
          onOpenArchive={() => setView('archive')}
        />
      )}
      <Toast msg={toast} onClose={() => setToast(null)} />
    </>
  );
}
