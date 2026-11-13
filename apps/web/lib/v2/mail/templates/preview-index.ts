/**
 * The mail previews by slug, name and kind, with no template or fixture import: what the visual harness
 * (tests/visual/pages.ts) reads, since Playwright's loader cannot import the JSON fixtures the renders
 * use. `previews.ts` gives each slug its render; its `Record<MailPreviewSlug, …>` type makes the two
 * lists hold the same slugs.
 */
import type { MailKind } from '../types';

export const MAIL_PREVIEW_INDEX = [
  { slug: 'check-notify', name: 'Check notify, finished', kind: 'check_notify' },
  { slug: 'check-notify-failed', name: 'Check notify, failed', kind: 'check_notify' },
  { slug: 'fix-to-developer', name: 'Fix to a developer', kind: 'fix_to_developer' },
  { slug: 'trial-reminder', name: 'Trial reminder, no card', kind: 'trial_reminder' },
  {
    slug: 'trial-reminder-card',
    name: 'Trial reminder, card on file, Agency',
    kind: 'trial_reminder',
  },
  { slug: 'email-change-confirm', name: 'Email change, confirm', kind: 'email_change_confirm' },
  {
    slug: 'email-change-notice',
    name: 'Email change, notice to the old address',
    kind: 'email_change_notice',
  },
  { slug: 'account-delete', name: 'Account deletion, confirm and restore', kind: 'account_delete' },
  { slug: 'alert', name: 'Alert', kind: 'alert' },
  { slug: 'weekly-summary', name: 'Weekly summary', kind: 'weekly_summary' },
  { slug: 'agency-plus-contact', name: 'Agency Plus request', kind: 'agency_plus_contact' },
  { slug: 'founder-event', name: 'Founder notice, first payment', kind: 'founder_event' },
  { slug: 'founder-overflow', name: 'Founder notice, N more', kind: 'founder_event' },
  { slug: 'founder-digest-daily', name: 'Founder digest, daily', kind: 'founder_digest' },
  { slug: 'founder-digest-weekly', name: 'Founder digest, weekly', kind: 'founder_digest' },
] as const satisfies readonly { slug: string; name: string; kind: MailKind }[];

export type MailPreviewSlug = (typeof MAIL_PREVIEW_INDEX)[number]['slug'];
