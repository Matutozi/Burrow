/**
 * What the user may do, from their license and trial. Pure.
 *
 * Paid after the trial: archiving new tabs (by hand or automatically), and with it page-text saving.
 * Always free: scores, reopening, searching (side panel and address bar), export, import and delete.
 * People never lose access to their own data.
 */
import type { LicenseInfo } from './key';

/** Length of the free trial. A product decision, not a user setting, so it lives here rather than in Preferences. */
export const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Entitlement =
  | { status: 'licensed'; license: LicenseInfo }
  | { status: 'trial'; daysLeft: number; endsAt: number }
  | { status: 'expired'; endedAt: number };

export function entitlement(license: LicenseInfo | null, trialStartedAt: number, now: number): Entitlement {
  if (license) return { status: 'licensed', license };
  const endsAt = trialStartedAt + TRIAL_DAYS * DAY_MS;
  if (now < endsAt) return { status: 'trial', daysLeft: Math.ceil((endsAt - now) / DAY_MS), endsAt };
  return { status: 'expired', endedAt: endsAt };
}

export function canArchive(e: Entitlement): boolean {
  return e.status !== 'expired';
}
