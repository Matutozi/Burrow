import type { CustomCategory } from '../prefs/types';
import { LIMITS } from '../prefs/validate';
import { Invalid, parseDomains, PRIORITY_OPTIONS, Segmented, splitList } from './form';

/** A category while it is being edited: sites and keywords stay as typed until the wizard saves. */
export interface CategoryDraft {
  id: string;
  name: string;
  priority: CustomCategory['priority'];
  indexPolicy: CustomCategory['indexPolicy'];
  sitesText: string;
  keywordsText: string;
}

export function toDrafts(categories: CustomCategory[]): CategoryDraft[] {
  return categories.map(({ domains, keywords, ...rest }) => ({
    ...rest,
    sitesText: domains.join(', '),
    keywordsText: keywords.join(', '),
  }));
}

/** Drafts back to categories. Unnamed drafts are dropped; preferences validation does the rest. */
export function fromDrafts(drafts: CategoryDraft[]): CustomCategory[] {
  return drafts
    .filter((d) => d.name.trim())
    .map(({ sitesText, keywordsText, ...rest }) => ({
      ...rest,
      name: rest.name.trim(),
      domains: parseDomains(sitesText).domains,
      keywords: splitList(keywordsText).map((k) => k.toLowerCase()),
    }));
}

function newDraft(): CategoryDraft {
  return {
    id: `cat-${crypto.randomUUID().slice(0, 8)}`,
    name: '',
    priority: 'high',
    // Data minimisation: save only the title unless the user asks for more.
    indexPolicy: 'title',
    sitesText: '',
    keywordsText: '',
  };
}

interface Props {
  drafts: CategoryDraft[];
  onChange: (drafts: CategoryDraft[]) => void;
}

/** "Your own categories": named kinds of page with their own priority, found by site or keyword. */
export function CategoryEditor({ drafts, onChange }: Props) {
  const set = (id: string, patch: Partial<CategoryDraft>) =>
    onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <div class="categories">
      <h2>Your own categories</h2>
      <p class="muted">
        Add the kinds of page that matter to you, like "IEEE opportunities" or "Travel grants". Burrow spots them by
        site or by words in the title or address, and checks them before the list above.
      </p>
      {drafts.map((d) => {
        const sites = parseDomains(d.sitesText);
        const empty = !d.sitesText.trim() && !d.keywordsText.trim();
        return (
          <fieldset class="category" key={d.id}>
            <legend class="sr-only">{d.name || 'New category'}</legend>
            <div class="category-head">
              <input
                type="text"
                aria-label="Category name"
                placeholder="Category name, e.g. Travel grants"
                maxLength={LIMITS.maxCategoryNameLength}
                value={d.name}
                onInput={(e) => set(d.id, { name: e.currentTarget.value })}
              />
              <Segmented
                label={`Priority for ${d.name || 'new category'}`}
                value={d.priority}
                options={PRIORITY_OPTIONS}
                onChange={(priority) => set(d.id, { priority })}
              />
            </div>
            <label class="field">
              Sites
              <input
                type="text"
                placeholder="ieee.org, conferences.ieee.org"
                value={d.sitesText}
                onInput={(e) => set(d.id, { sitesText: e.currentTarget.value })}
              />
              <Invalid items={sites.invalid} />
            </label>
            <label class="field">
              Words in the title or address
              <input
                type="text"
                placeholder="call for papers, travel grant, fellowship"
                value={d.keywordsText}
                onInput={(e) => set(d.id, { keywordsText: e.currentTarget.value })}
              />
            </label>
            {d.name.trim() && empty && (
              <small class="error-text">Add at least one site or word so Burrow can find these tabs.</small>
            )}
            {!d.name.trim() && (d.sitesText || d.keywordsText) && (
              <small class="error-text">Give this category a name, or it won't be saved.</small>
            )}
            <button
              type="button"
              class="link remove"
              onClick={() => onChange(drafts.filter((x) => x.id !== d.id))}
              aria-label={`Remove ${d.name || 'this category'}`}
            >
              Remove
            </button>
          </fieldset>
        );
      })}
      {drafts.length < LIMITS.maxCategories && (
        <button type="button" class="secondary small" onClick={() => onChange([...drafts, newDraft()])}>
          + Add a category
        </button>
      )}
    </div>
  );
}
