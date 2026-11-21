import { useId } from 'preact/hooks';
import { ARCHIVE_LIMITS } from '../archive/record';
import { LABEL_TEXT } from './format';

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Names already in use, offered as suggestions so "School" isn't typed five different ways. */
  suggestions: string[];
  label?: string;
}

/** "Save under: [School]". Optional: empty means no name. */
export function LabelInput({ value, onChange, suggestions, label = LABEL_TEXT.saveUnder }: Props) {
  const listId = useId();
  return (
    <label class="save-under">
      <span>{label}</span>
      <input
        type="text"
        list={listId}
        maxLength={ARCHIVE_LIMITS.maxLabelLength}
        placeholder={LABEL_TEXT.placeholder}
        value={value}
        onInput={(e) => onChange(e.currentTarget.value)}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option value={s} />
        ))}
      </datalist>
    </label>
  );
}
