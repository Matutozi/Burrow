import { useEffect, useState } from 'preact/hooks';
import { loadPreferences, onPreferencesChanged, savePreferences } from '../prefs/storage';
import type { Preferences } from '../prefs/types';
import { Onboarding } from './Onboarding';
import { TabList } from './TabList';

export function App() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPreferences()
      .then(setPrefs)
      .catch(() => setError('Could not load your settings.'));
    return onPreferencesChanged(setPrefs);
  }, []);

  if (error) return <p class="error">{error}</p>;
  if (!prefs) return null;

  if (!prefs.onboarded || editing) {
    return (
      <Onboarding
        initial={prefs}
        onDone={async (next) => {
          try {
            await savePreferences({ ...next, onboarded: true });
            setEditing(false);
          } catch {
            setError('Could not save your settings.');
          }
        }}
        onCancel={prefs.onboarded ? () => setEditing(false) : undefined}
      />
    );
  }

  return <TabList prefs={prefs} onEditPreferences={() => setEditing(true)} />;
}
