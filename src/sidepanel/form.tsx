/** Small form pieces shared by the setup wizard and the category editor. */
import { useId } from 'preact/hooks';
import type { IndexPolicy, Priority } from '../prefs/types';
import { cleanDomain } from '../prefs/validate';

export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseDomains(text: string): { domains: string[]; invalid: string[] } {
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
export function Segmented<T extends string>(props: {
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
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={props.value === o.value}
            onChange={() => props.onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Invalid({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return <small class="error-text">Not understood, will be skipped: {items.join('; ')}</small>;
}

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
] as const satisfies readonly { value: Priority; label: string }[];

export const INDEX_OPTIONS = [
  { value: 'never', label: 'Nothing' },
  { value: 'title', label: 'Title' },
  { value: 'full', label: 'Full text' },
] as const satisfies readonly { value: IndexPolicy; label: string }[];
