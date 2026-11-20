import { useState } from 'preact/hooks';
import { normalizeDomain } from '../prefs/classify';
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

interface Props {
  initial: Preferences;
  onDone: (prefs: Preferences) => void;
  onCancel?: () => void;
}

const STEPS = ['About you', 'What matters', 'Topics & sites', 'What to save', 'Cleanup'] as const;
const SENSITIVE = new Set(['email', 'finance', 'health']);

const WEIGHT_FIELDS: [keyof ScoringWeights, string][] = [
  ['recencyMax', 'Points for a recently used tab'],
  ['activityMax', 'Max points for visits and time on page'],
  ['priorityPoints', 'Points for high (or against low) priority content'],
  ['topicPoints', 'Points for matching one of your topics'],
  ['lowPrioritySitePoints', 'Points against low-priority sites'],
];

function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function domainList(text: string): string[] {
  return [...new Set(splitList(text).map(normalizeDomain).filter(Boolean))];
}

function Segmented<T extends string>(props: {
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.name}>
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          class={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
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
  const parsedRules = parseSiteRules(rulesText);

  const update = (patch: Partial<Preferences>) => setPrefs((p) => ({ ...p, ...patch }));

  const choosePersona = (persona: Persona) =>
    update({ persona, contentPriority: { ...PERSONA_PRIORITIES[persona] } });

  const finish = () =>
    onDone({
      ...prefs,
      topics: [...new Set(splitList(topicsText).map((t) => t.toLowerCase()))],
      alwaysImportant: domainList(importantText),
      lowPriority: domainList(lowText),
      siteRules: parsedRules.rules,
    });

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
          <div class="choices">
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
                  name={CONTENT_TYPE_LABELS[t]}
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
              placeholder="react, machine learning, startups"
              value={topicsText}
              onInput={(e) => setTopicsText(e.currentTarget.value)}
            />
            <small class="muted">Tabs that mention these get a boost.</small>
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
          </label>
          <label class="field">
            Your own site categories
            <textarea
              rows={3}
              placeholder={'github.com = work\nyoutube.com = docs'}
              value={rulesText}
              onInput={(e) => setRulesText(e.currentTarget.value)}
            />
            <small class="muted">
              One per line: site = {CONTENT_TYPES.join(', ')}. These override Burrow's built-in lists.
            </small>
            {parsedRules.invalid.length > 0 && (
              <small class="error-text">Not understood, will be skipped: {parsedRules.invalid.join('; ')}</small>
            )}
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
                  name={CONTENT_TYPE_LABELS[t]}
                  value={prefs.indexPolicy[t]}
                  options={INDEX_OPTIONS}
                  onChange={(v) => update({ indexPolicy: { ...prefs.indexPolicy, [t]: v } })}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 4 && (
        <section>
          <h2>When is a tab clutter?</h2>
          <label class="field">
            A tab goes stale after
            <select
              value={prefs.staleAfterDays}
              onChange={(e) => update({ staleAfterDays: Number(e.currentTarget.value) })}
            >
              {[1, 3, 7, 14].map((d) => (
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
              min={10}
              max={60}
              step={5}
              value={prefs.archiveThreshold}
              onInput={(e) => update({ archiveThreshold: Number(e.currentTarget.value) })}
            />
          </label>
          <fieldset class="field">
            <legend>When a tab is clutter</legend>
            <Segmented
              name="Archive mode"
              value={prefs.mode}
              options={[
                { value: 'suggest', label: 'Ask me first' },
                { value: 'auto', label: 'Archive automatically' },
              ]}
              onChange={(mode) => update({ mode })}
            />
            <small class="muted">Archived tabs are saved, never deleted, and you can restore them anytime.</small>
          </fieldset>
          <details class="advanced">
            <summary>Advanced: tune the scoring formula</summary>
            {WEIGHT_FIELDS.map(([key, label]) => (
              <label class="field inline">
                {label}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={prefs.weights[key]}
                  onInput={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (Number.isFinite(n)) update({ weights: { ...prefs.weights, [key]: Math.min(100, Math.max(0, n)) } });
                  }}
                />
              </label>
            ))}
            <button type="button" class="secondary small" onClick={() => update({ weights: { ...DEFAULT_WEIGHTS } })}>
              Reset to defaults
            </button>
          </details>
        </section>
      )}

      <footer class="actions">
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
        <button type="button" class="primary" onClick={() => (last ? finish() : setStep(step + 1))}>
          {last ? 'Finish' : 'Next'}
        </button>
      </footer>
    </main>
  );
}
