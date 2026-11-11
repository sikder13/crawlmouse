/**
 * Settings' written sentences (Final-Settings): every number a parameter or a named constant. The
 * lock corrections for the artboard follow.
 */
import type { Addition, CopyChange } from '../copy-registry';
import { listOf } from '../format';
import { capitalise, count, numberWord, plural } from '../words';

/** Evidence older than this is condensed to headers and changed parts (FACTS A6, long form). */
export const EVIDENCE_CONDENSED_AFTER_DAYS = 90;
/** Cancelling a plan takes this many clicks, with no retention offer in the path (FACTS D5, L6). */
export const CANCEL_CLICKS = 2;
/** A deleted account can be restored by a sign-in link for this long (FACTS E6, ARCH-2 §3.2). */
export const DELETE_GRACE_DAYS = 7;

export const SETTINGS_COPY = {
  title: 'Settings',
  trialLeft: (plan: string, days: number) =>
    `${plan} trial, ${count(days)} ${plural(days, 'day', 'days')} left`,
  accountTitle: 'Account',
  emailLabel: 'Email',
  emailHint: 'Sign-in links and alerts go here. Changing it sends a link to the new address first.',
  nameLabel: 'Name',
  namePlaceholder: 'Optional',
  nameHint: (agency: boolean) =>
    agency
      ? 'Shown on sign-in links and on client reports.'
      : 'Shown on sign-in links and, on Agency, on client reports.',
  signInTitle: 'Sign-in',
  signIn: (minutes: number) =>
    `Email link only; there is no password to lose. Links work once, for ${count(minutes)} minutes.`,
  save: 'Save',
  emailTitle: 'Email',
  kinds: {
    sign_in_link: 'Sign-in links',
    change_note: 'A note when a check finds a change',
    trial_reminder: (days: number, trial: number) =>
      `One reminder ${numberWord(days)} days before the ${trial} days end`,
  },
  signInDetail: (sender: string) => `when you ask for one · ${sender}`,
  changeNoteDetail: (sender: string) => `${sender} · per the rules under Alerts`,
  noTrial: 'only during a trial',
  always: 'always',
  /** FACTS A9: Stripe sends the receipts. */
  emailFoot: (kinds: number) =>
    `Those are the ${numberWord(kinds)} kinds from us. If you pay, Stripe sends the receipts. There is no newsletter and no product-update mail to unsubscribe from.`,
  dangerTitle: 'Danger',
  deleteLabel: 'Delete this account',
  /** FACTS E6: the seven-day undo. */
  deleteText: (sites: number, grace: number) =>
    `${
      sites === 0
        ? 'Removes the account and its reports'
        : sites === 1
          ? 'Removes the site, its history and reports'
          : sites === 2
            ? 'Removes both sites, their history and reports'
            : `Removes all ${numberWord(sites)} sites, their history and reports`
    }. Takes effect after a confirmation link. For ${numberWord(grace)} days the sign-in email can undo it; after that nothing is kept.`,
  deleteAction: 'Delete…',
  /** The confirmation step (owner ruling 12). */
  deleteSteps: (what: string, email: string, grace: number) =>
    `Type the ${what} below and we send a confirmation link to ${email}. The link opens a page where you confirm the deletion; sign-in then stops at once, and for ${numberWord(grace)} days a sign-in link from that address restores the account.`,
  hostnameNoun: 'hostname',
  emailNoun: 'sign-in address',
  retype: (expected: string) => `Type ${expected} to confirm`,
  retypeHint: 'Nothing is deleted until you confirm on the page the link opens.',
  sendDeleteLink: 'Send the confirmation link',
  deleteCardTitle: 'What deleting removes',
  keepAccount: 'Keep the account',
  /** The accounts the person alone holds, which the deletion removes with them (plan-revision R2). */
  removes: (hosts: readonly string[]) =>
    `Deleting removes ${count(hosts.length)} ${plural(hosts.length, 'account', 'accounts')} you alone hold: ${listOf(hosts)}.`,
  noSiteAccount: 'an account with no site',
  planTitle: 'Plan',
  trialName: (plan: string) => `${plan}, trial`,
  daysLeft: (n: number) => `${count(n)} ${plural(n, 'day', 'days')} left`,
  ends: (date: string) => `Ends ${date}.`,
  noCardTerms: (plan: string) =>
    `No card on file; nothing is charged unless you add one and choose ${plan}.`,
  cardTerms: (last4: string) => `The card ending ${last4} is charged then unless you cancel.`,
  freeNote: (schedule: string, fixes: number) =>
    `One site, ${schedule} checks, the ${numberWord(fixes)} largest fixes of each audit.`,
  sitesUsed: 'Sites',
  pagesUsed: 'Pages crawled, largest site',
  of: (n: number, of: number) => `${count(n)} of ${count(of)}`,
  keep: (plan: string, price: number) => `Keep ${plan}, $${price} a month`,
  choose: (plan: string, price: number) => `Choose ${plan}, $${price} a month`,
  other: (yearly: number, agency: number, sites: number, seats: number) =>
    `Or $${yearly} a year. Agency, $${agency} a month: ${count(sites)} sites, ${count(seats)} seats, reports under your brand.`,
  otherYearly: (yearly: number) => `Or $${yearly} a year.`,
  agencyLine: (agency: number, sites: number, seats: number) =>
    `Agency, $${agency} a month: ${count(sites)} sites, ${count(seats)} seats, reports under your brand.`,
  /** The plan's prices where the card has no Keep before them. */
  prices: (plan: string, monthly: number, yearly: number) =>
    `${plan} is $${monthly} a month, or $${yearly} a year.`,
  /** A past_due account keeps its plan for the grace days (ARCH-2 §3.1, DECISION-LOG J3). */
  pastDueEnded: (failed: string, ended: string) =>
    `The last payment failed on ${failed}, and the grace days ended on ${ended}: the account is on Free. Update the card in the billing portal to choose a plan again.`,
  pastDue: (failed: string, until: string, plan: string) =>
    `The last payment failed on ${failed}. ${plan} stays until ${until}; update the card in the billing portal to keep it.`,
  compare: 'Compare',
  cancel: 'Cancel',
  /** FACTS A6 (long form) and D5 (two clicks). */
  cancelTrial: (clicks: number, days: number) =>
    `Nothing to cancel on a trial; it ends by itself. On Pro or Agency, "Cancel, back to Free" sits here: ${numberWord(clicks)} clicks, effective at the end of the paid month. Nothing you can see is deleted; evidence older than ${days} days is condensed to headers and the parts of pages that changed.`,
  /** A trial with a card becomes the plan at its end unless it is cancelled (ARCH-2 §3.1). */
  cancelCardTrial: (date: string, clicks: number, days: number) =>
    `The trial ends ${date} and the card is charged unless you cancel: ${numberWord(clicks)} clicks, effective when the trial ends. Nothing you can see is deleted; evidence older than ${days} days is condensed to headers and the parts of pages that changed.`,
  cancelPaid: (clicks: number, days: number, period: 'month' | 'year') =>
    `${capitalise(numberWord(clicks))} clicks, effective at the end of the paid ${period}. Nothing you can see is deleted; evidence older than ${days} days is condensed to headers and the parts of pages that changed.`,
  cancelAction: 'Cancel, back to Free',
  /** A paid plan set to end at its period's end is shown until then (spec 27 "Cancel"). */
  cancelling: (plan: string, date: string) =>
    `${plan} until ${date}, then Free. Nothing more is charged.`,
  cancelled: (date: string, days: number) =>
    `Cancelled; it takes effect ${date}. Nothing you can see is deleted; evidence older than ${days} days is condensed to headers and the parts of pages that changed.`,
  cancelFree: 'Nothing to cancel on Free.',
  receipts: 'Receipts',
  /** FACTS A9. */
  receiptsText: 'Emailed by Stripe after each charge, and listed in the billing portal from here',
  /** Before any charge there is no Stripe customer, so no portal to list them in. */
  noReceipts: 'Emailed by Stripe after each charge; there has been no charge yet.',
  portalAction: 'Billing portal',
  free: 'Free',
  tables: { email: 'Email kinds', danger: 'Delete', usage: 'Usage', terms: 'Cancel' },
  columns: { kind: 'Kind', detail: 'Detail', control: 'Setting', item: 'Item', value: 'Value' },
};

// ── Where Settings differs from its locked HTML ──────────────────────────────────────────────
// Applied in order by the lock comparison (__tests__/v2/settings.test.tsx).

const ZONE =
  'FACTS D4 and Q4 (owner ruling): dates and times in the account’s zone, America/Indiana/Indianapolis; the locked page wrote them in UTC';
const DAYS =
  'FACTS D4 and Q4 (owner ruling): calendar days in the account’s zone, Fri 30 Oct to Sat 7 Nov';

export const SETTINGS_CHANGES: CopyChange[] = [
  // The rail's trial card: this page carries the plan, so the card leaves its terms and Keep here.
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'ends Sun 8 Nov',
    rendered: 'ends Sat 7 Nov',
    source: `${ZONE}: trial_ends_at 8 Nov 02:41Z is Sat 7 Nov 21:41 there`,
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: '9 days left',
    rendered: '8 days left',
    source: DAYS,
  },
  {
    screen: 'settings',
    kind: 'ruling',
    locked:
      "Then Free: example-outfitter.com keeps monthly checks; the other four sites pause until you choose Pro or remove them. Nothing is deleted. We'll email you two days before.",
    rendered: 'No card on file. Nothing is charged unless you choose Pro.',
    // In the trial card's note, which the locked page and ours hide on a phone.
    hiddenOnPhone: true,
    source:
      'Owner ruling 10 (change a, as applied): a page that carries the plan’s terms and its Keep has the rail’s trial card leave them to it (`plan: page`); what Free keeps is on the plan card',
  },
  {
    screen: 'settings',
    kind: 'ruling',
    locked: 'Keep Pro, $19 a month Theme',
    rendered: 'Theme',
    source:
      'Owner ruling 10 (change a, as applied): the plan card’s Keep is the one on this page; the rail’s is left out',
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'Pro trial, 9 days left',
    rendered: 'Pro trial, 8 days left',
    source: DAYS,
  },
  {
    screen: 'settings',
    kind: 'fixture',
    locked: 'Save Email changed, not yet saved',
    rendered: 'Save',
    source:
      'The fixture’s account address is you@company.com: the locked page shows an edit in progress, which the preview, filled from the account, does not',
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'signin@crawlmouse.com',
    rendered: 'magic@crawlmouse.com',
    source:
      'FACTS correction (CC-25 ruling 8, CC-27 D8): the sign-in link is sent from magic@ until CC-28 moves the Supabase template to signin@; the page names SIGNIN_SENDER',
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'One reminder two days before the 14 days end Fri 6 Nov',
    rendered: 'One reminder three days before the 14 days end Wed 4 Nov',
    source: `FACTS A8 (three days before); ${ZONE}: 5 Nov 02:41Z is Wed 4 Nov 21:41 there, where A8 wrote the UTC date, Thu 5 Nov`,
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'Those are the three kinds. There is no newsletter',
    rendered:
      'Those are the three kinds from us. If you pay, Stripe sends the receipts. There is no newsletter',
    source: 'FACTS A9',
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'Takes effect after a confirmation link; nothing is kept.',
    rendered:
      'Takes effect after a confirmation link. For seven days the sign-in email can undo it; after that nothing is kept.',
    source: 'FACTS E6',
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: '9 days left',
    rendered: '8 days left',
    source: DAYS,
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'Ends Sun 8 Nov.',
    rendered: 'Ends Sat 7 Nov.',
    source: `${ZONE}: trial_ends_at 8 Nov 02:41Z is Sat 7 Nov 21:41 there`,
  },
  {
    screen: 'settings',
    kind: 'ruling',
    locked: 'Sites 5 of 5',
    rendered: 'Sites 4 of 5',
    source:
      'Owner ruling Q10: a staging site holds no primary slot (ARCH-2 §2.5), so four of the plan’s five, as the dashboard counts them',
  },
  {
    screen: 'settings',
    kind: 'ruling',
    locked: 'Agency, $69 a month',
    rendered: 'Agency, $99 a month',
    source:
      'Owner ruling of 2026-11-03: the Agency list price is $99 (lib/billing/prices.ts, CC-27 D8)',
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'one click, effective at the end of the paid month, nothing deleted.',
    rendered:
      'two clicks, effective at the end of the paid month. Nothing you can see is deleted; evidence older than 90 days is condensed to headers and the parts of pages that changed.',
    source: 'FACTS A6 (long form) and D5 (two clicks)',
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'Listed here once there is a charge',
    rendered: 'Emailed by Stripe after each charge, and listed in the billing portal from here',
    source: 'FACTS A9',
  },
  {
    screen: 'settings',
    kind: 'fixture',
    locked: 'Emailed by Stripe after each charge, and listed in the billing portal from here',
    rendered: 'Emailed by Stripe after each charge; there has been no charge yet.',
    source:
      'The fixture’s account has no card and no charge: there is no Stripe customer, so no billing portal lists receipts (FACTS A9’s wording is for an account that has paid)',
  },
  {
    screen: 'settings',
    kind: 'ruling',
    locked:
      'Connected Slack Nahl · #seo connected Search Console AI-feature impressions by page Connect Vercel audit each deploy of staging connected API key read-only, for your own scripts Create',
    rendered: '',
    source:
      'Owner ruling 11 (with the plan): Integrations is a later step with its own rail entry, so Settings leaves out the Connected card',
  },
];

export const SETTINGS_ADDITIONS: Addition[] = [];
