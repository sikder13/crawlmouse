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
  { slug: 'seat-invite', name: 'Seat invitation, account manager', kind: 'seat_invite' },
  {
    slug: 'seat-invite-unnamed',
    name: 'Seat invitation, developer, an account with no name',
    kind: 'seat_invite',
  },
  { slug: 'report-confirm', name: 'Client report, confirm the address', kind: 'report_confirm' },
  { slug: 'client-report', name: 'Client report', kind: 'client_report' },
] as const satisfies readonly { slug: string; name: string; kind: MailKind }[];

export type MailPreviewSlug = (typeof MAIL_PREVIEW_INDEX)[number]['slug'];
