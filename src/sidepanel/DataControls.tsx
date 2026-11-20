import { useRef, useState } from 'preact/hooks';
import { deleteAllData, restoreAllData, type DataAreas } from '../archive/allData';
import { buildExport, exportFileName } from '../archive/export';
import { importRecords, MAX_IMPORT_BYTES, parseImport, undoImport } from '../archive/importData';
import type { ArchiveRecord } from '../archive/record';
import { chromeAreas, savePreferences } from '../prefs/storage';
import type { Preferences } from '../prefs/types';
import { downloadJson } from './chromeTabs';
import { ARCHIVE_TEXT, DATA_TEXT } from './format';
import type { Notify } from './Toast';

function dataAreas(): DataAreas {
  return { prefs: chromeAreas(), local: chrome.storage.local, session: chrome.storage.session };
}

interface Props {
  prefs: Preferences;
  records: ArchiveRecord[];
  notify: Notify;
  /** Deletes the given archived pages with an undo (owned by the archive view). */
  onDeleteRecords: (records: ArchiveRecord[]) => Promise<void>;
}

/** Export, import and delete: the user's rights to access, move and erase their data. */
export function DataControls({ prefs, records, notify, onDeleteRecords }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await job();
    } finally {
      setBusy(false);
    }
  };

  function exportData() {
    try {
      const now = Date.now();
      downloadJson(buildExport(prefs, records, now), exportFileName(now));
    } catch (err) {
      console.error('Burrow: export failed', err);
      notify({ text: ARCHIVE_TEXT.exportFailed, error: true });
    }
  }

  const importFile = (file: File) =>
    run(async () => {
      try {
        if (file.size > MAX_IMPORT_BYTES) {
          notify({ text: DATA_TEXT.importErrors.tooLarge, error: true });
          return;
        }
        const parsed = await parseImport(await file.text());
        if (typeof parsed === 'string') {
          notify({ text: DATA_TEXT.importErrors[parsed], error: true });
          return;
        }
        const replacePrefs = parsed.preferences !== null && confirm(DATA_TEXT.confirmImportPrefs);
        const result = await importRecords(parsed.records, chrome.storage.local);
        const oldPrefs = prefs;
        if (replacePrefs && parsed.preferences) await savePreferences({ ...parsed.preferences, onboarded: true });
        notify({
          text: `${DATA_TEXT.imported(result.written.length, result.unchanged)}${replacePrefs ? ` · ${DATA_TEXT.importedPrefs}` : ''}`,
          undo: async () => {
            try {
              await undoImport(result, chrome.storage.local);
              if (replacePrefs) await savePreferences(oldPrefs);
              notify({ text: DATA_TEXT.importUndone });
            } catch (err) {
              console.error('Burrow: undo import failed', err);
              notify({ text: DATA_TEXT.undoFailed, error: true });
            }
          },
        });
      } catch (err) {
        console.error('Burrow: import failed', err);
        notify({ text: DATA_TEXT.importFailed, error: true });
      }
    });

  const deleteEverything = () =>
    run(async () => {
      if (!confirm(DATA_TEXT.confirmDeleteEverything)) return;
      try {
        const snapshot = await deleteAllData(dataAreas());
        notify({
          text: DATA_TEXT.deletedEverything,
          undo: async () => {
            try {
              await restoreAllData(snapshot, dataAreas());
              notify({ text: DATA_TEXT.restoredEverything });
            } catch (err) {
              console.error('Burrow: restore failed', err);
              notify({ text: DATA_TEXT.restoreFailed, error: true });
            }
          },
        });
      } catch (err) {
        console.error('Burrow: delete all failed', err);
        notify({ text: DATA_TEXT.deleteEverythingFailed, error: true });
      }
    });

  return (
    <section class="advanced">
      <h2>Your data</h2>
      <p class="muted">
        Archived pages are stored on this device only. Click a page to reopen it, or type <kbd>burrow</kbd> and a space
        in the address bar to search them from anywhere.
      </p>
      <div class="buttons">
        <button type="button" class="secondary small" onClick={exportData}>
          Export all data
        </button>
        <button type="button" class="secondary small" disabled={busy} onClick={() => fileInput.current?.click()}>
          {DATA_TEXT.importButton}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void importFile(file);
          }}
        />
        {records.length > 0 && (
          <button
            type="button"
            class="secondary small danger"
            disabled={busy}
            onClick={() => {
              if (confirm(ARCHIVE_TEXT.confirmDeleteAll(records.length))) void onDeleteRecords(records);
            }}
          >
            Delete all archived pages
          </button>
        )}
        <button type="button" class="secondary small danger" disabled={busy} onClick={() => void deleteEverything()}>
          {DATA_TEXT.deleteEverything}
        </button>
      </div>
    </section>
  );
}
