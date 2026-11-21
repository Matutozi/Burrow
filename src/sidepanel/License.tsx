import { useEffect, useState } from 'preact/hooks';
import { PURCHASE_URL } from '../license/config';
import type { Entitlement } from '../license/entitlement';
import { activateLicense, currentEntitlement, onLicenseChanged, removeLicense } from '../license/store';
import { LICENSE_TEXT } from './format';
import type { Notify } from './Toast';

/** Re-checks hourly so the trial countdown and expiry update while the panel stays open. */
const RECHECK_MS = 60 * 60 * 1000;

export function useEntitlement(): Entitlement | null {
  const [ent, setEnt] = useState<Entitlement | null>(null);
  useEffect(() => {
    const reload = () =>
      currentEntitlement().then(setEnt, (err: unknown) => console.error('Burrow: could not read license', err));
    void reload();
    const unsubscribe = onLicenseChanged(() => void reload());
    const timer = setInterval(() => void reload(), RECHECK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  return ent;
}

/** Small status button for the tab list header. Hidden once licensed. */
export function LicenseChip({ ent, onOpen }: { ent: Entitlement | null; onOpen: () => void }) {
  if (!ent || ent.status === 'licensed') return null;
  const expired = ent.status === 'expired';
  return (
    <button type="button" class={`secondary small${expired ? ' danger' : ''}`} onClick={onOpen}>
      {expired ? LICENSE_TEXT.chipExpired : LICENSE_TEXT.chipTrial(ent.daysLeft)}
    </button>
  );
}

export function LicenseView({ ent, notify, onBack }: { ent: Entitlement | null; notify: Notify; onBack: () => void }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function activate() {
    if (busy || !input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const info = await activateLicense(input);
      if (!info) {
        setError(LICENSE_TEXT.invalid);
        return;
      }
      setInput('');
      notify({ text: LICENSE_TEXT.activated });
    } catch (err) {
      console.error('Burrow: could not save license', err);
      setError(LICENSE_TEXT.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(LICENSE_TEXT.confirmRemove)) return;
    try {
      const key = await removeLicense();
      notify({
        text: LICENSE_TEXT.removed,
        undo: key
          ? async () => {
              await activateLicense(key);
              notify({ text: LICENSE_TEXT.restored });
            }
          : undefined,
      });
    } catch (err) {
      console.error('Burrow: could not remove license', err);
      notify({ text: LICENSE_TEXT.saveFailed, error: true });
    }
  }

  return (
    <main class="tablist">
      <header class="bar">
        <h1>{LICENSE_TEXT.title}</h1>
        <button type="button" class="secondary small" onClick={onBack}>
          {LICENSE_TEXT.back}
        </button>
      </header>

      {ent?.status === 'trial' && <p>{LICENSE_TEXT.trial(ent.daysLeft, ent.endsAt)}</p>}
      {ent?.status === 'expired' && <p class="error-text">{LICENSE_TEXT.expired(ent.endedAt)}</p>}
      {ent?.status === 'licensed' && <p>{LICENSE_TEXT.licensed(ent.license.id, ent.license.issuedAt)}</p>}
      <p>{LICENSE_TEXT.paid}</p>
      <p class="muted">{LICENSE_TEXT.alwaysFree}</p>

      {ent?.status !== 'licensed' && (
        <>
          {PURCHASE_URL && (
            <p>
              <a class="primary small buy" href={PURCHASE_URL} target="_blank" rel="noreferrer">
                {LICENSE_TEXT.buy}
              </a>
            </p>
          )}
          <label class="field">
            {LICENSE_TEXT.keyLabel}
            <textarea
              rows={3}
              placeholder={LICENSE_TEXT.keyPlaceholder}
              spellcheck={false}
              autocomplete="off"
              value={input}
              onInput={(e) => setInput(e.currentTarget.value)}
            />
          </label>
          {error && <p class="error-text">{error}</p>}
          <button type="button" class="primary small" disabled={busy || !input.trim()} onClick={() => void activate()}>
            {LICENSE_TEXT.activate}
          </button>
        </>
      )}

      {ent?.status === 'licensed' && (
        <button type="button" class="secondary small danger" onClick={() => void remove()}>
          {LICENSE_TEXT.remove}
        </button>
      )}
      <p class="muted">
        <small>{LICENSE_TEXT.offline}</small>
      </p>
    </main>
  );
}
