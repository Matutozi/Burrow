import { useEffect, useMemo, useState } from 'preact/hooks';
import { readActivity } from '../activity/store';
import { EMPTY_ACTIVITY } from '../activity/tracker';
import { runArchive, undoIfUnchanged } from '../archive/chromeApi';
import { planArchive, signalsOf } from '../archive/plan';
import { archiveBlocker, cleanLabel } from '../archive/record';
import { applyGroups, readGroups, undoGroups } from '../groups/chromeGroups';
import { GROUP_COLORS, type GroupColor } from '../groups/info';
import {
  addGroup,
  ARCHIVE_KEY,
  archivableIn,
  archiveGroup,
  confirmedGroups,
  leftAsIs,
  moveTab,
  planOrganise,
  updateGroup,
  type OrganisePlan,
} from '../groups/organise';
import { mayArchive } from '../license/store';
import { hostOf } from '../prefs/classify';
import type { Preferences } from '../prefs/types';
import { createScorer } from '../scoring/score';
import { GROUP_TEXT } from './format';
import { LabelInput } from './LabelInput';
import type { Notify } from './Toast';

interface Props {
  prefs: Preferences;
  notify: Notify;
  onDone: () => void;
  onOpenLicense: () => void;
  /** "Save under" names already used, for suggestions. */
  savedLabels: string[];
}

interface TabLabel {
  title: string;
  host: string;
  score: number;
  /** The existing group a tab is in, if any. */
  group?: string;
}

interface Proposal {
  plan: OrganisePlan;
  labels: Map<number, TabLabel>;
  total: number;
  archiveAllowed: boolean;
}

/** Reads every open tab once and proposes what to keep, group and archive. The proposal stays still while the user edits it. */
async function propose(prefs: Preferences): Promise<Proposal> {
  const now = Date.now();
  const [tabs, groups, activity, archiveAllowed] = await Promise.all([
    chrome.tabs.query({}),
    readGroups(),
    prefs.trackActivity ? readActivity() : Promise.resolve(EMPTY_ACTIVITY),
    mayArchive(),
  ]);
  const scorer = createScorer(prefs);
  const labels = new Map<number, TabLabel>();
  const entries = tabs.flatMap((tab) => {
    if (tab.id === undefined || tab.incognito) return [];
    const url = tab.url ?? '';
    const result = scorer.score(signalsOf(tab, activity, now, groups), now);
    labels.set(tab.id, {
      title: tab.title || url,
      host: hostOf(url) ?? '',
      score: result.score,
      group: groups.get(tab.groupId)?.title,
    });
    return [
      {
        tabId: tab.id,
        title: tab.title ?? '',
        url,
        pinned: tab.pinned,
        groupId: tab.groupId,
        result,
        clutter: scorer.isArchiveCandidate(result),
        archivable: !result.protected && archiveBlocker(url, result.indexPolicy) === null,
      },
    ];
  });
  return {
    plan: planOrganise(entries, prefs.groupMinTabs, archiveAllowed),
    labels,
    total: entries.length,
    archiveAllowed,
  };
}

export function OrganiseView({ prefs, notify, onDone, onOpenLicense, savedLabels }: Props) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [plan, setPlan] = useState<OrganisePlan | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveUnder, setSaveUnder] = useState('');

  useEffect(() => {
    // Computed once: the proposal must not reset while the user is editing it.
    propose(prefs).then(
      (p) => {
        setProposal(p);
        setPlan(p.plan);
      },
      (err: unknown) => {
        console.error('Burrow: could not read tabs to organise', err);
        setError(true);
      },
    );
  }, []);

  const toGroup = useMemo(() => (plan ? confirmedGroups(plan) : []), [plan]);

  if (error) return <p class="error">{GROUP_TEXT.failed}</p>;
  if (!plan || !proposal) return null;
  const { labels } = proposal;

  const groupedTabs = toGroup.reduce((n, g) => n + g.tabIds.length, 0);
  const keepCount = proposal.total - plan.archive.length;

  /** Archives first (save, then close), then creates groups. One undo reverses both. */
  async function confirm() {
    if (!plan || busy || (groupedTabs === 0 && plan.archive.length === 0)) return;
    setBusy(true);
    try {
      let archived = 0;
      let keptOpen = 0;
      let undoArchive: (() => Promise<unknown>) | null = null;
      if (plan.archive.length > 0) {
        const now = Date.now();
        const [fresh, groups, activity] = await Promise.all([
          Promise.all(plan.archive.map((id) => chrome.tabs.get(id).catch(() => null))),
          readGroups(),
          prefs.trackActivity ? readActivity() : Promise.resolve(EMPTY_ACTIVITY),
        ]);
        const tabs = fresh.filter((t): t is chrome.tabs.Tab => t !== null);
        // The user chose these tabs in the preview, so the score threshold is skipped; protection still applies.
        // Name for each page: its group's name if it was put away with "Archive group", else the name typed
        // for the Archive section, else the Chrome group it came from.
        const typed = cleanLabel(saveUnder);
        const names = new Map(
          plan.archive.flatMap((id) => {
            const name = plan.archiveLabels.get(id) ?? (typed || labels.get(id)?.group);
            return name ? [[id, name] as const] : [];
          }),
        );
        const archivePlan = planArchive(tabs, {
          scorer: createScorer(prefs),
          prefs,
          activity,
          groups,
          labels: names,
          now,
          chosen: true,
        });
        const result = await runArchive(archivePlan, prefs);
        if (result.locked) {
          keptOpen = plan.archive.length;
        } else {
          archived = result.archivedTabIds.length - result.closeFailedTabIds.length;
          keptOpen = plan.archive.length - archived;
          if (result.undo.saved.length > 0) undoArchive = () => undoIfUnchanged(result.undo, archivePlan.places);
        }
      }

      const grouping = toGroup.length > 0 ? await applyGroups(toGroup) : null;
      const undoGrouping = grouping && grouping.undo.tabIds.length > 0 ? grouping.undo : null;

      notify({
        text: GROUP_TEXT.doneBoth(
          archived,
          keptOpen,
          grouping?.groupsCreated ?? 0,
          grouping?.groupsExtended ?? 0,
          grouping?.skipped ?? 0,
        ),
        undo:
          undoArchive || undoGrouping
            ? async () => {
                try {
                  if (undoGrouping) await undoGroups(undoGrouping);
                  if (undoArchive) await undoArchive();
                  notify({ text: GROUP_TEXT.undone });
                } catch (err) {
                  console.error('Burrow: undo organise failed', err);
                  notify({ text: GROUP_TEXT.failed, error: true });
                }
              }
            : undefined,
      });
      onDone();
    } catch (err) {
      console.error('Burrow: organise failed', err);
      notify({ text: GROUP_TEXT.failed, error: true });
    } finally {
      setBusy(false);
    }
  }

  const groupOptions = plan.groups.map((g) => ({ key: g.key, title: g.title.trim() || GROUP_TEXT.newGroupName }));

  const tabRow = (tabId: number, current: string | null) => {
    const label = labels.get(tabId);
    const fromGroup = plan.inGroup.has(tabId);
    return (
      <li key={tabId} class="org-tab">
        <span class="body">
          <span class="title">{label?.title}</span>
          <span class="reason">
            {label?.score} · {label?.host}
            {label?.group ? ` · in "${label.group}"` : ''}
          </span>
        </span>
        <select
          aria-label={`${GROUP_TEXT.moveTo}: ${label?.title ?? ''}`}
          value={current ?? ''}
          onChange={(e) => setPlan(moveTab(plan, tabId, e.currentTarget.value || null))}
        >
          {plan.archivable.has(tabId) && <option value={ARCHIVE_KEY}>{GROUP_TEXT.archiveOption}</option>}
          {fromGroup ? (
            <option value="">{GROUP_TEXT.keepInGroup}</option>
          ) : (
            <>
              {groupOptions.map((o) => (
                <option value={o.key}>{o.title}</option>
              ))}
              <option value="">{GROUP_TEXT.noGroup}</option>
            </>
          )}
        </select>
      </li>
    );
  };

  return (
    <main class="tablist organise">
      <header class="bar">
        <h1>{GROUP_TEXT.title}</h1>
      </header>
      <p class="summary">{GROUP_TEXT.summary(proposal.total, keepCount, plan.archive.length)}</p>
      <p class="muted">{GROUP_TEXT.intro}</p>

      <h2>{GROUP_TEXT.archiveHeading(plan.archive.length)}</h2>
      {proposal.archiveAllowed ? (
        <section class="org-group archive">
          <p class="muted">
            <small>{GROUP_TEXT.archiveHelp}</small>
          </p>
          <LabelInput value={saveUnder} onChange={setSaveUnder} suggestions={savedLabels} />
          {plan.archive.length === 0 ? (
            <p class="muted">
              <small>{GROUP_TEXT.archiveEmpty}</small>
            </p>
          ) : (
            <ul class="tabs">{plan.archive.map((id) => tabRow(id, ARCHIVE_KEY))}</ul>
          )}
        </section>
      ) : (
        <p class="error-text">
          {GROUP_TEXT.archiveLocked}{' '}
          <button type="button" class="link" onClick={onOpenLicense}>
            {GROUP_TEXT.unlock}
          </button>
        </p>
      )}

      <h2>{GROUP_TEXT.keepHeading(keepCount)}</h2>
      {plan.groups.map((g) => {
        const canArchive = archivableIn(plan, g.key);
        return (
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
            {canArchive > 0 && (
              <button type="button" class="link" onClick={() => setPlan(archiveGroup(plan, g.key))}>
                {GROUP_TEXT.archiveGroup(canArchive)}
              </button>
            )}
          </section>
        );
      })}

      <button type="button" class="secondary small" onClick={() => setPlan(addGroup(plan, ''))}>
        {GROUP_TEXT.addGroup}
      </button>

      {plan.ungrouped.length > 0 && (
        <details class="org-group">
          <summary>{GROUP_TEXT.ungroupedHeading(plan.ungrouped.length)}</summary>
          <ul class="tabs">{plan.ungrouped.map((id) => tabRow(id, null))}</ul>
        </details>
      )}

      {leftAsIs(plan) > 0 && (
        <p class="muted">
          <small>{GROUP_TEXT.leftAsIs(leftAsIs(plan))}</small>
        </p>
      )}

      <div class="actions">
        <button type="button" class="secondary" onClick={onDone}>
          {GROUP_TEXT.cancel}
        </button>
        <button
          type="button"
          class="primary"
          disabled={busy || (groupedTabs === 0 && plan.archive.length === 0)}
          onClick={() => void confirm()}
        >
          {busy ? GROUP_TEXT.working : GROUP_TEXT.confirmBoth(groupedTabs, plan.archive.length)}
        </button>
      </div>
    </main>
  );
}
