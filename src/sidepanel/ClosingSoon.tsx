import { pageOpener } from '../archive/chromeApi';
import { closingSoon, daysLeft } from '../archive/deadline';
import type { ArchiveRecord } from '../archive/record';
import type { Preferences } from '../prefs/types';
import { DEADLINE_TEXT, formatDate } from './format';
import type { Notify } from './Toast';

interface Props {
  records: ArchiveRecord[];
  prefs: Preferences;
  allowed: boolean;
  notify: Notify;
  onOpenLicense: () => void;
}

/** Saved opportunities whose deadline is near, so putting a tab away never means missing it. */
export function ClosingSoon({ records, prefs, allowed, notify, onOpenLicense }: Props) {
  if (!prefs.deadlineReminders) return null;
  const now = Date.now();
  const soon = closingSoon(records, now, prefs.deadlineWarnDays);
  if (soon.length === 0) return null;

  if (!allowed) {
    return (
      <p class="tip">
        {DEADLINE_TEXT.locked(soon.length)}{' '}
        <button type="button" class="link" onClick={onOpenLicense}>
          {DEADLINE_TEXT.unlock}
        </button>
      </p>
    );
  }

  return (
    <section class="closing">
      <h2>{DEADLINE_TEXT.heading(soon.length)}</h2>
      <ul class="tabs">
        {soon.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              class="tab"
              title={r.url}
              onClick={() =>
                void pageOpener(
                  {},
                  true,
                )([r]).catch((err: unknown) => {
                  console.error('Burrow: could not open page', err);
                  notify({ text: DEADLINE_TEXT.openFailed, error: true });
                })
              }
            >
              <span class="when">{DEADLINE_TEXT.inDays(daysLeft(r.deadline ?? now, now))}</span>
              <span class="body">
                <span class="title">{r.title || r.url}</span>
                <span class="reason">
                  {DEADLINE_TEXT.closes(formatDate(r.deadline ?? now))}
                  {r.label ? ` · ${r.label}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
