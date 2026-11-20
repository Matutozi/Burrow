import { useEffect, useState } from 'preact/hooks';
import { loadPreferences, onPreferencesChanged, savePreferences } from '../prefs/storage';
import type { Preferences } from '../prefs/types';
import { Onboarding } from './Onboarding';
import { TabList } from './TabList';

export function App() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState(false);

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

  return <TabList prefs={prefs} onEditPreferences={() => setEditing(true)} />;
}
