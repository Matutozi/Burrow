/**
 * What the user may do, from their license and trial. Pure.
 *
 * Free forever: the core job. Archiving by hand (tab list, "Archive this tab", the shortcut),
 * Save under names, reopening, searching (side panel and address bar, including text already saved),
 * export, import and delete.
 * Paid after the trial: the power features below.
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

export const PAID_FEATURES = ['autoArchive', 'organise', 'pageText', 'deadlines'] as const;
export type PaidFeature = (typeof PAID_FEATURES)[number];

/** Every paid feature is open during the trial and with a license. */
export function canUse(e: Entitlement, _feature: PaidFeature): boolean {
  return e.status !== 'expired';
}
