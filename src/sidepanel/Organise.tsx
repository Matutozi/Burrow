import { useEffect, useMemo, useState } from 'preact/hooks';
import { readActivity } from '../activity/store';
import { EMPTY_ACTIVITY } from '../activity/tracker';
import { signalsOf } from '../archive/plan';
import { applyGroups, readGroups, undoGroups } from '../groups/chromeGroups';
import { GROUP_COLORS, type GroupColor } from '../groups/info';
import { addGroup, confirmedGroups, moveTab, planOrganise, updateGroup, type OrganisePlan } from '../groups/organise';
import { hostOf } from '../prefs/classify';
import type { Preferences } from '../prefs/types';
import { createScorer } from '../scoring/score';
import { GROUP_TEXT } from './format';
import type { Notify } from './Toast';

interface Props {
  prefs: Preferences;
  notify: Notify;
  onDone: () => void;
}

interface TabLabel {
  title: string;
  host: string;
}

/** Reads every open tab once and proposes groups. The proposal stays still while the user edits it. */
async function propose(prefs: Preferences): Promise<{ plan: OrganisePlan; labels: Map<number, TabLabel> }> {
  const now = Date.now();
  const [tabs, groups, activity] = await Promise.all([
    chrome.tabs.query({}),
    readGroups(),
    prefs.trackActivity ? readActivity() : Promise.resolve(EMPTY_ACTIVITY),
  ]);
  const scorer = createScorer(prefs);
  const labels = new Map<number, TabLabel>();
  const entries = tabs.flatMap((tab) => {
    if (tab.id === undefined || tab.incognito) return [];
    const url = tab.url ?? '';
    labels.set(tab.id, { title: tab.title || url, host: hostOf(url) ?? '' });
    return [
      {
        tabId: tab.id,
        title: tab.title ?? '',
        url,
        pinned: tab.pinned,
        groupId: tab.groupId,
        result: scorer.score(signalsOf(tab, activity, now, groups), now),
      },
    ];
  });
  return { plan: planOrganise(entries, prefs.groupMinTabs), labels };
}

export function OrganiseView({ prefs, notify, onDone }: Props) {
  const [plan, setPlan] = useState<OrganisePlan | null>(null);
  const [labels, setLabels] = useState<Map<number, TabLabel>>(new Map());
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    propose(prefs).then(
      (r) => {
        setPlan(r.plan);
        setLabels(r.labels);
      },
      (err: unknown) => {
        console.error('Burrow: could not read tabs to organise', err);
        setError(true);
      },
    );
      // Computed once: the proposal must not reset while the user is editing it.
  }, []);

  const toCreate = useMemo(() => (plan ? confirmedGroups(plan) : []), [plan]);

  if (error) return <p class="error">{GROUP_TEXT.failed}</p>;
  if (!plan) return null;

  const grouped = plan.groups.reduce((n, g) => n + g.tabIds.length, 0);

  async function confirm() {
    if (busy || toCreate.length === 0) return;
    setBusy(true);
    try {
      const result = await applyGroups(toCreate);
      notify({
        text: GROUP_TEXT.done(result.groupsCreated, result.groupsExtended, result.skipped),
        undo:
          result.undo.tabIds.length > 0
            ? async () => {
                try {
                  await undoGroups(result.undo);
                  notify({ text: GROUP_TEXT.undone });
                } catch (err) {
                  console.error('Burrow: undo grouping failed', err);
                  notify({ text: GROUP_TEXT.failed, error: true });
                }
              }
            : undefined,
      });
      onDone();
    } catch (err) {
      console.error('Burrow: grouping failed', err);
      notify({ text: GROUP_TEXT.failed, error: true });
    } finally {
      setBusy(false);
    }
  }

  const options = plan.groups.map((g) => ({ key: g.key, title: g.title.trim() || GROUP_TEXT.newGroupName }));

  const tabRow = (tabId: number, current: string | null) => {
    const label = labels.get(tabId);
    return (
      <li key={tabId} class="org-tab">
        <span class="body">
          <span class="title">{label?.title}</span>
          <span class="reason">{label?.host}</span>
        </span>
        <select
          aria-label={`${GROUP_TEXT.moveTo}: ${label?.title ?? ''}`}
          value={current ?? ''}
          onChange={(e) => setPlan(moveTab(plan, tabId, e.currentTarget.value || null))}
        >
          {options.map((o) => (
            <option value={o.key}>{o.title}</option>
          ))}
          <option value="">{GROUP_TEXT.noGroup}</option>
        </select>
      </li>
    );
  };

  return (
    <main class="tablist organise">
      <header class="bar">
        <h1>{GROUP_TEXT.title}</h1>
      </header>

      {plan.groups.length === 0 && plan.ungrouped.length === 0 ? (
        <p class="muted">{GROUP_TEXT.nothing}</p>
      ) : (
        <>
          <p class="summary">
            {GROUP_TEXT.summary(grouped, plan.groups.length, plan.ungrouped.length, plan.untouched)}
          </p>
          <p class="muted">{GROUP_TEXT.intro}</p>
        </>
      )}

      {plan.groups.map((g) => (
        <section key={g.key} class={`org-group${g.include ? '' : ' skipped'}`}>
          <div class="org-head">
            <input
              type="checkbox"
              aria-label={`${GROUP_TEXT.include}: ${g.title}`}
              checked={g.include}
              onChange={(e) => setPlan(updateGroup(plan, g.key, { include: e.currentTarget.checked }))}
            />
            <span class={`dot ${g.color}`} aria-hidden="true" />
            <input
              type="text"
              aria-label={GROUP_TEXT.groupName}
              value={g.title}
              placeholder={GROUP_TEXT.newGroupName}
              onInput={(e) => setPlan(updateGroup(plan, g.key, { title: e.currentTarget.value }))}
            />
            <select
              aria-label={`${GROUP_TEXT.colour}: ${g.title}`}
              value={g.color}
              onChange={(e) => setPlan(updateGroup(plan, g.key, { color: e.currentTarget.value as GroupColor }))}
            >
              {GROUP_COLORS.map((c) => (
                <option value={c}>{GROUP_TEXT.colours[c]}</option>
              ))}
            </select>
            <span class="count">{g.tabIds.length}</span>
          </div>
          <ul class="tabs">{g.tabIds.map((id) => tabRow(id, g.key))}</ul>
        </section>
      ))}

      <button type="button" class="secondary small" onClick={() => setPlan(addGroup(plan, ''))}>
        {GROUP_TEXT.addGroup}
      </button>

      {plan.ungrouped.length > 0 && (
        <details class="org-group">
          <summary>{GROUP_TEXT.ungroupedHeading(plan.ungrouped.length)}</summary>
          <ul class="tabs">{plan.ungrouped.map((id) => tabRow(id, null))}</ul>
        </details>
      )}

      <div class="actions">
        <button type="button" class="secondary" onClick={onDone}>
          {GROUP_TEXT.cancel}
        </button>
        <button type="button" class="primary" disabled={busy || toCreate.length === 0} onClick={() => void confirm()}>
          {GROUP_TEXT.confirm(toCreate.length)}
        </button>
      </div>
    </main>
  );
}
