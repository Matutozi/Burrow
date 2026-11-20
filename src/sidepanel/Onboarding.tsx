import { useEffect, useId, useState } from 'preact/hooks';
import { DEFAULT_WEIGHTS, PERSONA_LABELS, PERSONA_PRIORITIES } from '../prefs/defaults';
import { formatSiteRules, parseSiteRules } from '../prefs/siteRules';
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  type IndexPolicy,
  type Persona,
  type Preferences,
  type Priority,
  type ScoringWeights,
} from '../prefs/types';
import { cleanDomain, LIMITS } from '../prefs/validate';
import { hasCaptureAccess, releaseCaptureAccess, requestCaptureAccess } from './chromeTabs';
import { ARCHIVE_TEXT } from './format';

interface Props {
  initial: Preferences;
  /** Rejects if saving failed, so the wizard can stay open and let the user retry. */
  onDone: (prefs: Preferences) => Promise<void>;
  onCancel?: () => void;
}

const STEPS = ['About you', 'What matters', 'Topics & sites', 'What to save', 'Cleanup'] as const;
const SENSITIVE = new Set(['email', 'finance', 'health']);

const WEIGHT_FIELDS: { key: keyof ScoringWeights; label: string; min: number }[] = [
  { key: 'recencyMax', label: 'Points for a recently used tab', min: 0 },
  { key: 'activityMax', label: 'Max points for visits and time on page', min: 0 },
  { key: 'activityFullVisits', label: 'Visits that earn full visit points', min: 1 },
  { key: 'activityFullMinutes', label: 'Minutes that earn full time points', min: 1 },
  { key: 'priorityPoints', label: 'Points for high (or against low) priority content', min: 0 },
  { key: 'topicPoints', label: 'Points for matching one of your topics', min: 0 },
  { key: 'lowPrioritySitePoints', label: 'Points against low-priority sites', min: 0 },
];

function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDomains(text: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const entry of splitList(text)) {
    const d = cleanDomain(entry);
    if (d) domains.push(d);
    else invalid.push(entry);
  }
  return { domains: [...new Set(domains)], invalid };
}

/** A row of choices built on native radio inputs, so keyboard and screen readers work for free. */
function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <label class={props.value === o.value ? 'on' : ''}>
          <input type="radio" name={name} value={o.value} checked={props.value === o.value} onChange={() => props.onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function Invalid({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return <small class="error-text">Not understood, will be skipped: {items.join('; ')}</small>;
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
] as const satisfies readonly { value: Priority; label: string }[];

const INDEX_OPTIONS = [
  { value: 'never', label: 'Nothing' },
  { value: 'title', label: 'Title' },
  { value: 'full', label: 'Full text' },
] as const satisfies readonly { value: IndexPolicy; label: string }[];

export function Onboarding({ initial, onDone, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [topicsText, setTopicsText] = useState(initial.topics.join(', '));
  const [importantText, setImportantText] = useState(initial.alwaysImportant.join(', '));
  const [lowText, setLowText] = useState(initial.lowPriority.join(', '));
  const [rulesText, setRulesText] = useState(formatSiteRules(initial.siteRules));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  /** Whether Chrome currently grants page access. Null until checked. */
  const [captureAccess, setCaptureAccess] = useState<boolean | null>(null);
  const [captureDenied, setCaptureDenied] = useState(false);

  useEffect(() => {
    void hasCaptureAccess().then(setCaptureAccess);
  }, []);

  const important = parseDomains(importantText);
  const low = parseDomains(lowText);
  const rules = parseSiteRules(rulesText);

  const update = (patch: Partial<Preferences>) => setPrefs((p) => ({ ...p, ...patch }));

  // Only reset priorities when the persona actually changes, so edits aren't lost by a stray click.
  const choosePersona = (persona: Persona) => {
    if (persona !== prefs.persona) update({ persona, contentPriority: { ...PERSONA_PRIORITIES[persona] } });
  };

  const toggleCapture = (on: boolean) => {
    setCaptureDenied(false);
    if (!on) {
      update({ captureText: false });
      setCaptureAccess(false);
      releaseCaptureAccess().catch((err: unknown) => console.error('Burrow: could not release page access', err));
      return;
    }
    // Chrome only shows the prompt during a click, so request before anything else awaits.
    requestCaptureAccess().then(
      (granted) => {
        setCaptureAccess(granted);
        setCaptureDenied(!granted);
        if (granted) update({ captureText: true });
      },
      (err: unknown) => {
        console.error('Burrow: page access request failed', err);
        setCaptureDenied(true);
      },
    );
  };

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await onDone({
        ...prefs,
        topics: splitList(topicsText),
        alwaysImportant: important.domains,
        lowPriority: low.domains,
        siteRules: rules.rules,
      });
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const last = step === STEPS.length - 1;

  return (
    <main class="onboarding">
      <header>
        <h1>{initial.onboarded ? 'Your preferences' : 'Set up Burrow'}</h1>
        <p class="muted">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>
        <div class="progress" aria-hidden="true">
          <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </header>

      {step === 0 && (
        <section>
          <h2>What do you mostly use your browser for?</h2>
          <p class="muted">This sets starting priorities. You can change every one on the next step.</p>
          <div class="choices" role="radiogroup" aria-label="Persona">
            {(Object.keys(PERSONA_LABELS) as Persona[]).map((p) => (
              <label class={`choice ${prefs.persona === p ? 'on' : ''}`}>
                <input type="radio" name="persona" checked={prefs.persona === p} onChange={() => choosePersona(p)} />
                {PERSONA_LABELS[p]}
              </label>
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <h2>How important is each kind of page?</h2>
          <p class="muted">High-priority tabs stay longer. Low-priority tabs are suggested for cleanup sooner.</p>
          <ul class="rows">
            {CONTENT_TYPES.map((t) => (
              <li>
                <span>{CONTENT_TYPE_LABELS[t]}</span>
                <Segmented
                  label={CONTENT_TYPE_LABELS[t]}
                  value={prefs.contentPriority[t]}
                  options={PRIORITY_OPTIONS}
                  onChange={(v) => update({ contentPriority: { ...prefs.contentPriority, [t]: v } })}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2>Topics and sites</h2>
          <label class="field">
            Topics you care about
            <textarea
              rows={2}
              placeholder="react, machine learning, scholarships"
              value={topicsText}
              onInput={(e) => setTopicsText(e.currentTarget.value)}
            />
            <small class="muted">
              Tabs that mention these get a boost. Up to {LIMITS.maxTopics} topics.
            </small>
          </label>
          <label class="field">
            Always important sites
            <textarea
              rows={2}
              placeholder="gmail.com, jira.mycompany.com"
              value={importantText}
              onInput={(e) => setImportantText(e.currentTarget.value)}
            />
            <small class="muted">Never suggested for cleanup.</small>
            <Invalid items={important.invalid} />
          </label>
          <label class="field">
            Low-priority sites
            <textarea
              rows={2}
              placeholder="news.ycombinator.com, twitter.com"
              value={lowText}
              onInput={(e) => setLowText(e.currentTarget.value)}
            />
            <small class="muted">Suggested for cleanup sooner.</small>
            <Invalid items={low.invalid} />
          </label>
          <label class="field">
            Your own site categories
            <textarea
              rows={3}
              placeholder={'gtbank.com = finance\nyoutube.com = docs'}
              value={rulesText}
              onInput={(e) => setRulesText(e.currentTarget.value)}
            />
            <small class="muted">
              One per line: site = {CONTENT_TYPES.join(', ')}. These override Burrow's built-in lists.
            </small>
            <Invalid items={rules.invalid} />
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={prefs.useBuiltInSiteLists}
              onChange={(e) => update({ useBuiltInSiteLists: e.currentTarget.checked })}
            />
            Use Burrow's built-in site lists for sites I haven't categorised
          </label>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2>What should Burrow save when it archives a tab?</h2>
          <p class="muted">
            Saved pages stay on this device only. Full text makes pages searchable by their content. Sensitive
            categories save nothing by default.
          </p>
          <ul class="rows">
            {CONTENT_TYPES.map((t) => (
              <li>
                <span>
                  {CONTENT_TYPE_LABELS[t]}
                  {SENSITIVE.has(t) && <small class="tag">sensitive</small>}
                </span>
                <Segmented
                  label={`Save for ${CONTENT_TYPE_LABELS[t]}`}
                  value={prefs.indexPolicy[t]}
                  options={INDEX_OPTIONS}
                  onChange={(v) => update({ indexPolicy: { ...prefs.indexPolicy, [t]: v } })}
                />
              </li>
            ))}
          </ul>
          <label class="check">
            <input
              type="checkbox"
              checked={prefs.captureText && captureAccess !== false}
              onChange={(e) => toggleCapture(e.currentTarget.checked)}
            />
            {ARCHIVE_TEXT.captureLabel}
          </label>
          <small class="muted">{ARCHIVE_TEXT.captureHelp}</small>
          {captureDenied && <p class="error-text">{ARCHIVE_TEXT.captureDenied}</p>}
          {prefs.captureText && captureAccess === false && !captureDenied && (
            <p class="error-text">{ARCHIVE_TEXT.captureMissing}</p>
          )}
        </section>
      )}

      {step === 4 && (
        <section>
          <h2>When is a tab clutter?</h2>
          <label class="field">
            A tab goes stale after
            <select value={prefs.staleAfterDays} onChange={(e) => update({ staleAfterDays: Number(e.currentTarget.value) })}>
              {[...new Set([1, 3, 7, 14, 30, prefs.staleAfterDays])]
                .sort((a, b) => a - b)
                .map((d) => (
                  <option value={d}>
                    {d} day{d === 1 ? '' : 's'} untouched
                  </option>
                ))}
            </select>
          </label>
          <label class="field">
            Suggest cleanup for tabs scoring below {prefs.archiveThreshold}
            <input
              type="range"
              min={5}
              max={80}
              step={5}
              value={prefs.archiveThreshold}
              onInput={(e) => update({ archiveThreshold: Number(e.currentTarget.value) })}
            />
          </label>
          <fieldset class="field">
            <legend>When a tab is clutter</legend>
            <Segmented
              label="Archive mode"
              value={prefs.mode}
              options={[
                { value: 'suggest', label: 'Ask me first' },
                { value: 'auto', label: 'Archive automatically' },
              ]}
              onChange={(mode) => update({ mode })}
            />
            <small class="muted">Archived tabs are saved, never deleted, and you can restore them anytime.</small>
            {prefs.mode === 'auto' && (
              <small class="muted">Automatic archiving is coming in a later version. Until then Burrow asks first.</small>
            )}
          </fieldset>
          <label class="check">
            <input type="checkbox" checked={prefs.trackActivity} onChange={(e) => update({ trackActivity: e.currentTarget.checked })} />
            Use how often and how long I use each tab to score it
          </label>
          <small class="muted">
            Kept in memory on this device only and cleared when Chrome closes. Off means scores use only recency and
            your preferences.
          </small>

          <details class="advanced">
            <summary>Advanced: tune the scoring formula</summary>
            {WEIGHT_FIELDS.map(({ key, label, min }) => (
              <label class="field inline">
                {label}
                <input
                  type="number"
                  min={min}
                  max={LIMITS.weight.max}
                  value={prefs.weights[key]}
                  onInput={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (e.currentTarget.value !== '' && Number.isFinite(n)) {
                      update({ weights: { ...prefs.weights, [key]: Math.min(LIMITS.weight.max, Math.max(min, n)) } });
                    }
                  }}
                />
              </label>
            ))}
            <label class="field inline">
              Seconds without input before time stops counting
              <input
                type="number"
                min={LIMITS.idleAfterSeconds.min}
                max={LIMITS.idleAfterSeconds.max}
                value={prefs.idleAfterSeconds}
                onInput={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (e.currentTarget.value !== '' && Number.isFinite(n)) update({ idleAfterSeconds: n });
                }}
              />
            </label>
            <button type="button" class="secondary small" onClick={() => update({ weights: { ...DEFAULT_WEIGHTS } })}>
              Reset formula to defaults
            </button>
          </details>
        </section>
      )}

      <footer class="actions">
        {saveError && <span class="error-text" role="alert">Couldn't save. Try again.</span>}
        {step > 0 ? (
          <button type="button" class="secondary" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : (
          onCancel && (
            <button type="button" class="secondary" onClick={onCancel}>
              Cancel
            </button>
          )
        )}
        <button type="button" class="primary" disabled={saving} onClick={() => (last ? void finish() : setStep(step + 1))}>
          {last ? (saving ? 'Saving…' : 'Finish') : 'Next'}
        </button>
      </footer>
    </main>
  );
}
