import { useEffect, useMemo, useState } from 'preact/hooks';
import { buildExport, exportFileName } from '../archive/export';
import { createArchiveSearch, textSnippet, type ArchiveRecord } from '../archive/record';
import { listArchive, onArchiveChanged, putRecords, removeRecords, restoreRecords } from '../archive/store';
import { hostOf } from '../prefs/classify';
import { CONTENT_TYPE_LABELS, type Preferences } from '../prefs/types';
import { pageOpener } from '../archive/chromeApi';
import { downloadJson } from './chromeTabs';
import { ARCHIVE_TEXT, formatDate } from './format';
import type { Notify } from './Toast';

/** Rows rendered at once. More load on request, so huge archives stay fast. */
const PAGE_SIZE = 200;
/** Wait this long after typing stops before searching, so big archives don't stutter. */
const SEARCH_DEBOUNCE_MS = 120;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** All archived records, kept fresh across side panels and windows. */
export function useArchive(): ArchiveRecord[] {
  const [records, setRecords] = useState<ArchiveRecord[]>([]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      // One reload per burst of writes.
      timer = setTimeout(() => {
        listArchive().then(setRecords, (err: unknown) => console.error('Burrow: could not read archive', err));
      }, 100);
    };
    reload();
    const unsubscribe = onArchiveChanged(reload);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
  return records;
}

interface Props {
  prefs: Preferences;
  records: ArchiveRecord[];
  notify: Notify;
  onBack: () => void;
}

export function ArchiveView({ prefs, records, notify, onBack }: Props) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const search = useMemo(() => createArchiveSearch(records), [records]);
  const activeQuery = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const matches = useMemo(() => search(activeQuery), [search, activeQuery]);
  const shown = matches.slice(0, limit);

  async function deleteWithUndo(targets: ArchiveRecord[]) {
    try {
      const removed = await removeRecords(targets.map((r) => r.id));
      notify({
        text: ARCHIVE_TEXT.deleted(removed.length),
        undo: async () => {
          try {
            await putRecords(removed);
            notify(null);
          } catch (err) {
            console.error('Burrow: undo delete failed', err);
            notify({ text: ARCHIVE_TEXT.deleteFailed, error: true });
          }
        },
      });
    } catch (err) {
      console.error('Burrow: delete failed', err);
      notify({ text: ARCHIVE_TEXT.deleteFailed, error: true });
    }
  }

  async function restore(record: ArchiveRecord) {
    try {
      await restoreRecords([record], pageOpener({}, true));
      notify({ text: ARCHIVE_TEXT.restored(1) });
    } catch (err) {
      console.error('Burrow: restore failed', err);
      notify({ text: ARCHIVE_TEXT.restoreFailed, error: true });
    }
  }

  function exportData() {
    try {
      const now = Date.now();
      downloadJson(buildExport(prefs, records, now), exportFileName(now));
    } catch (err) {
      console.error('Burrow: export failed', err);
      notify({ text: ARCHIVE_TEXT.exportFailed, error: true });
    }
  }

  return (
    <main class="tablist">
      <header class="bar">
        <h1>Archive</h1>
        <button type="button" class="secondary small" onClick={onBack}>
          Back to tabs
        </button>
      </header>

      <input
        type="search"
        class="search"
        placeholder="Search titles, addresses and saved text"
        aria-label="Search archived pages"
        value={query}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setLimit(PAGE_SIZE);
        }}
      />
      <p class="summary">
        {activeQuery
          ? `${matches.length} of ${ARCHIVE_TEXT.count(records.length)}`
          : ARCHIVE_TEXT.count(records.length)}
      </p>

      {records.length === 0 && <p class="muted">{ARCHIVE_TEXT.empty}</p>}
      {records.length > 0 && matches.length === 0 && <p class="muted">{ARCHIVE_TEXT.noMatches}</p>}

      <ul class="tabs">
        {shown.map((r) => {
          const snippet = activeQuery ? textSnippet(r, activeQuery) : null;
          return (
            <li key={r.id} class="row">
              <button type="button" class="tab" onClick={() => void restore(r)} title={`Reopen ${r.url}`}>
                <span class="body">
                  <span class="title">{r.title || r.url}</span>
                  <span class="reason">
                    <span class="type">{CONTENT_TYPE_LABELS[r.contentType]}</span>
                    {r.saved === 'full' && <span class="type">{ARCHIVE_TEXT.fullText}</span>}
                    {hostOf(r.url)} · {formatDate(r.archivedAt)}
                  </span>
                  {snippet && <span class="snippet">{snippet}</span>}
                </span>
              </button>
              <button
                type="button"
                class="link"
                onClick={() => void deleteWithUndo([r])}
                aria-label={`Delete ${r.title || r.url}`}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
      {matches.length > limit && (
        <button type="button" class="secondary small more" onClick={() => setLimit(limit + PAGE_SIZE)}>
          Show more ({matches.length - limit} left)
        </button>
      )}

      <section class="advanced">
        <h2>Your data</h2>
        <p class="muted">Archived pages are stored on this device only. Click a page to reopen it.</p>
        <div class="buttons">
          <button type="button" class="secondary small" onClick={exportData}>
            Export all data
          </button>
          {records.length > 0 && (
            <button
              type="button"
              class="secondary small danger"
              onClick={() => {
                if (confirm(ARCHIVE_TEXT.confirmDeleteAll(records.length))) void deleteWithUndo(records);
              }}
            >
              Delete all archived pages
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
