import { useEffect, useState } from 'preact/hooks';
import { loadPreferences, onPreferencesChanged, savePreferences } from '../prefs/storage';
import type { Preferences } from '../prefs/types';
import { ArchiveView, useArchive } from './Archive';
import { LicenseView, useEntitlement } from './License';
import { OrganiseView } from './Organise';
import { requestGroupAccess } from '../groups/chromeGroups';
import { GROUP_TEXT } from './format';
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

  if (!prefs.onboarded || editing) {
    return (
      <>
        <Onboarding
          initial={prefs}
          onDone={async (next) => {
            // Throws on failure. Onboarding stays open and offers a retry.
            setPrefs(await savePreferences({ ...next, onboarded: true }));
            setEditing(false);
          }}
          onCancel={prefs.onboarded ? () => setEditing(false) : undefined}
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
      {view === 'organise' && <OrganiseView prefs={prefs} notify={setToast} onDone={() => setView('tabs')} />}
      {view === 'license' && <LicenseView ent={entitlement} notify={setToast} onBack={() => setView('tabs')} />}
      {view === 'tabs' && (
        <TabList
          prefs={prefs}
          archiveCount={records.length}
          notify={setToast}
          entitlement={entitlement}
          onEditPreferences={() => setEditing(true)}
          onOpenArchive={() => setView('archive')}
          onOpenLicense={() => setView('license')}
          onOrganise={() => {
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
