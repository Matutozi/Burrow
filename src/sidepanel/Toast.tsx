import { ARCHIVE_TEXT } from './format';

export interface ToastMessage {
  text: string;
  error?: boolean;
  /** Offered until the toast is dismissed or replaced. Stays as long as the user needs it, no timeout. */
  undo?: () => Promise<void>;
}

export type Notify = (msg: ToastMessage | null) => void;

export function Toast({ msg, onClose }: { msg: ToastMessage | null; onClose: () => void }) {
  return (
    <div class="toast-region" role="status" aria-live="polite">
      {msg && (
        <div class={`toast${msg.error ? ' error-toast' : ''}`}>
          <span>{msg.text}</span>
          {msg.undo && (
            <button type="button" class="link" onClick={() => void msg.undo?.()}>
              {ARCHIVE_TEXT.undo}
            </button>
          )}
          <button type="button" class="link" aria-label="Dismiss" onClick={onClose}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
