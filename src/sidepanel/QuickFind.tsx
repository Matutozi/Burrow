import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { hasCaptureAccess, pageOpener } from '../archive/chromeApi';
import { createArchiveSearch, labelsIn, textSnippet, type ArchiveRecord } from '../archive/record';
import { hostOf } from '../prefs/classify';
import type { Preferences } from '../prefs/types';
import { formatDate, FIND_TEXT } from './format';
import { requestCaptureAccess } from './chromeTabs';
import type { Notify } from './Toast';

/** Results shown inline. The Archive view has the full list. */
const MAX_RESULTS = 30;
const DEBOUNCE_MS = 120;
/** Name chips shown under the box. */
const MAX_CHIPS = 6;

interface Props {
  records: ArchiveRecord[];
  prefs: Preferences;
  notify: Notify;
  /** Page-text saving is a paid feature after the trial. */
  pageTextAllowed: boolean;
  onOpenLicense: () => void;
  onSavePrefs: (prefs: Preferences) => Promise<void>;
  onOpenArchive: () => void;
  /** The rest of the tab list, shown while the box is empty. */
  children: ComponentChildren;
}

/**
 * "Find anything you put away": the first thing in the panel, because getting things back is the
 * reason to trust Burrow with closing them. Opening a result keeps it in the archive, like a bookmark.
 */
export function QuickFind({
  records,
  prefs,
  notify,
  pageTextAllowed,
  onOpenLicense,
  onSavePrefs,
  onOpenArchive,
  children,
}: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setActive(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const search = useMemo(() => createArchiveSearch(records), [records]);
  const results = useMemo(() => (active ? search(active) : []), [search, active]);
  const chips = useMemo(() => labelsIn(records).slice(0, MAX_CHIPS), [records]);

  async function open(r: ArchiveRecord) {
    try {
      await pageOpener({}, true)([r]);
    } catch (err) {
      console.error('Burrow: could not open page', err);
      notify({ text: FIND_TEXT.openFailed, error: true });
    }
  }

  function turnOnPageText() {
    if (!pageTextAllowed) {
      onOpenLicense();
      return;
    }
    // Chrome only shows the permission prompt during a click, so ask before anything else awaits.
    requestCaptureAccess().then(
      async (granted) => {
        if (!granted || !(await hasCaptureAccess())) {
          notify({ text: FIND_TEXT.pageTextDenied, error: true });
          return;
        }
        await onSavePrefs({ ...prefs, captureText: true });
        notify({ text: FIND_TEXT.pageTextOn });
      },
      () => notify({ text: FIND_TEXT.pageTextDenied, error: true }),
    );
  }

  return (
    <>
      <div class="find">
        <input
          type="search"
          class="find-box"
          placeholder={FIND_TEXT.placeholder(records.length)}
          aria-label={FIND_TEXT.label}
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            const first = results[0];
            if (e.key === 'Enter' && first) void open(first);
            if (e.key === 'Escape') setQuery('');
          }}
        />
        {chips.length > 0 && !query && (
          <div class="chips" role="group" aria-label={FIND_TEXT.chipsLabel}>
            {chips.map((c) => (
              <button type="button" class="chip" onClick={() => setQuery(c.name)}>
                {c.name} ({c.count})
              </button>
            ))}
          </div>
        )}
      </div>

      {!query ? (
        children
      ) : (
        <section class="find-results">
          <p class="summary">
            {FIND_TEXT.count(results.length)}{' '}
            <button type="button" class="link" onClick={onOpenArchive}>
              {FIND_TEXT.openArchive}
            </button>
          </p>
          <ul class="tabs">
            {results.slice(0, MAX_RESULTS).map((r) => {
              const snippet = textSnippet(r, active);
              return (
                <li key={r.id}>
                  <button type="button" class="tab" onClick={() => void open(r)} title={r.url}>
                    <span class="body">
                      <span class="title">{r.title || r.url}</span>
                      <span class="reason">
                        {r.label && <span class="label-tag">{r.label}</span>}
                        {hostOf(r.url)} · {formatDate(r.archivedAt)}
                      </span>
                      {snippet && <span class="snippet">{snippet}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!prefs.captureText && records.length > 0 && (
            <p class="tip">
              {FIND_TEXT.pageTextTip}{' '}
              <button type="button" class="link" onClick={turnOnPageText}>
                {FIND_TEXT.pageTextButton}
              </button>
            </p>
          )}
        </section>
      )}
    </>
  );
}
