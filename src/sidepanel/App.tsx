import { useEffect, useMemo, useState } from 'preact/hooks';
import { labelsIn } from '../archive/record';
import { canUse } from '../license/entitlement';
import { loadPreferences, onPreferencesChanged, savePreferences } from '../prefs/storage';
import type { Preferences } from '../prefs/types';
import { ArchiveView, useArchive } from './Archive';
import { LicenseView, useEntitlement } from './License';
import { OrganiseView } from './Organise';
import { requestGroupAccess } from '../groups/chromeGroups';
import { GROUP_TEXT, WELCOME_TEXT } from './format';
import { Onboarding } from './Onboarding';
import { TabList } from './TabList';
import { Toast, type ToastMessage } from './Toast';

export function App() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<'tabs' | 'archive' | 'license' | 'organise'>('tabs');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const records = useArchive();
  const entitlement = useEntitlement();
  const savedLabels = useMemo(() => labelsIn(records).map((l) => l.name), [records]);

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

  const toastView = <Toast msg={toast} onClose={() => setToast(null)} />;

  // Setup is optional: new users start on their tabs with a welcome card, and can personalise later.
  if (editing) {
    return (
      <>
        <Onboarding
          initial={prefs}
          onDone={async (next) => {
            // Throws on failure. Onboarding stays open and offers a retry.
            setPrefs(await savePreferences({ ...next, onboarded: true }));
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
        {/* Stays visible after "Delete all data" sends the user back to setup, so undo is still offered. */}
        <div class="raise">{toastView}</div>
      </>
    );
  }

  return (
    <>
      {view === 'archive' && (
        <ArchiveView prefs={prefs} records={records} notify={setToast} onBack={() => setView('tabs')} />
      )}
      {view === 'organise' && (
        <OrganiseView prefs={prefs} notify={setToast} onDone={() => setView('tabs')} savedLabels={savedLabels} />
      )}
      {view === 'license' && <LicenseView ent={entitlement} notify={setToast} onBack={() => setView('tabs')} />}
      {view === 'tabs' && (
        <TabList
          prefs={prefs}
          records={records}
          onSavePrefs={async (next) => setPrefs(await savePreferences(next))}
          savedLabels={savedLabels}
          notify={setToast}
          entitlement={entitlement}
          onEditPreferences={() => setEditing(true)}
          onDismissWelcome={() => {
            savePreferences({ ...prefs, onboarded: true }).then(setPrefs, () =>
              setToast({ text: WELCOME_TEXT.saveFailed, error: true }),
            );
          }}
          onOpenArchive={() => setView('archive')}
          onOpenLicense={() => setView('license')}
          onOrganise={() => {
            if (entitlement && !canUse(entitlement, 'organise')) {
              setView('license');
              return;
            }
            // Must run inside the click. Chrome grants tabGroups without a prompt.
            requestGroupAccess().then(
              (granted) => (granted ? setView('organise') : setToast({ text: GROUP_TEXT.needAccess, error: true })),
              () => setToast({ text: GROUP_TEXT.needAccess, error: true }),
            );
          }}
        />
      )}
      {toastView}
    </>
  );
}
