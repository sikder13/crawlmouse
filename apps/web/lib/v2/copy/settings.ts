/**
 * Settings' written sentences (Final-Settings): every number a parameter or a named constant. The
 * lock corrections for the artboard follow.
 */
import { SUPPORT_EMAIL } from './support';
import { SIGNIN_SENDER, SIGNIN_SENDER_LOCKED } from '../../auth/constants';
import type { Addition, CopyChange } from '../copy-registry';
import { listOf } from '../format';
import { capitalise, count, numberWord, plural } from '../words';
import { formatPlanPrice } from './plan-price';
import { brandLogoAlt } from '../view/brand-card';

/** Evidence older than this is condensed to headers and changed parts (FACTS A6, long form). */
export const EVIDENCE_CONDENSED_AFTER_DAYS = 90;
/** Cancelling a plan takes this many clicks, with no retention offer in the path (FACTS D5, L6). */
export const CANCEL_CLICKS = 2;
/**
 * A deleted account can be restored by its restore link for this long (FACTS E6, ARCH-2 §3.2): the
 * deletion copy's RESTORE_DAYS, so the window has one owner.
 */
export { RESTORE_DAYS as DELETE_GRACE_DAYS } from './deletion';

const OR = new Intl.ListFormat('en-GB', { style: 'long', type: 'disjunction' });

/** "PNG, JPEG or WebP"; with `article`, "a PNG, JPEG or WebP". */
function orList(items: readonly string[], article = false): string {
  return `${article ? 'a ' : ''}${OR.format(items)}`;
}

export const SETTINGS_COPY = {
  title: 'Settings',
  trialLeft: (plan: string, days: number) =>
    `${plan} trial, ${count(days)} ${plural(days, 'day', 'days')} left`,
  accountTitle: 'Account',
  emailLabel: 'Email',
  emailHint: 'Sign-in links and alerts go here. Changing it sends a link to the new address first.',
  /** The sign-in address, read by anyone but the owner (ARCH-2 §5: the change is the owner's). */
  emailOwnerOnly: 'Sign-in links and alerts go here. Only the account’s owner can change it.',
  nameLabel: 'Name',
  namePlaceholder: 'Optional',
  /**
   * Where the account name is shown today: sign-in links, and the mail that asks a client to confirm
   * reports and then sends them (`agencyName` in mail/templates/client-report.ts and
   * report-confirm.ts, read from `accounts.name`). No client report reads the Branding card's name
   * yet, so no reading says one does (V2R register, row 24). `agency`: the account's plan;
   * `reportsShown`: whether the Goal 1 switch shows `agency_white_label`.
   */
  nameHint: ({ agency, reportsShown }: { agency: boolean; reportsShown: boolean }) =>
    !reportsShown
      ? 'Shown on sign-in links.'
      : agency
        ? 'Shown on sign-in links and in client-report mail.'
        : 'Shown on sign-in links and, on Agency, in client-report mail.',
  /** The white-label brand (Goal 1 row 24): the card's fixed words; its limits are parameters. */
  branding: {
    title: 'Branding',
    sub: 'The name and logo for your client reports.',
    nameLabel: 'Brand name',
    logoLabel: 'Logo',
    /** `formats` from the validator's formats, `kb` and `px` from its constants. */
    logoHint: (formats: readonly string[], kb: number, px: number) =>
      `${orList(formats)}, up to ${count(kb)} KB and ${count(px)} pixels a side. Leave it empty to keep the current logo.`,
    currentLogo: 'Current logo',
    noLogo: 'No logo yet',
    logoAlt: brandLogoAlt,
    save: 'Save branding',
    saving: 'Saving…',
    saved: 'Branding saved.',
    savedReload: 'Branding saved. The logo shows here after a reload.',
    rateLimited: (perHour: number) =>
      `Branding can be saved ${numberWord(perHour)} times an hour. Try again in an hour.`,
    logoErrors: {
      empty: 'That file is empty. Choose an image.',
      tooLarge: (kb: number) => `That logo is over ${count(kb)} KB. Choose a smaller file.`,
      unsupported: (formats: readonly string[]) =>
        `That file is not ${orList(formats, true)} image.`,
      malformed: 'That image could not be read. Export it again and choose the new file.',
      dimensions: (px: number) =>
        `That logo must be between 1 and ${count(px)} pixels on each side.`,
      other: 'That logo could not be saved. Choose another image.',
    },
    failed: 'Branding was not saved. Try again in a minute.',
    signedOut: 'Your session has ended. Sign in again, then save.',
    signIn: 'Sign in',
    roleRefused:
      'Your role on this account cannot set branding. The owner or an account manager can.',
    planRefused: 'This account’s plan does not include branding.',
    unavailable: 'Branding is not available right now.',
  },
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
  emailFoot: (kinds: number, plansOpen = true) =>
    `Those are the ${numberWord(kinds)} kinds from us.${plansOpen ? ' If you pay, Stripe sends the receipts.' : ''} There is no newsletter and no product-update mail to unsubscribe from.`,
  /**
   * The member's own address, once a hard bounce or a spam report suppressed it (CC-28 D7): every kind
   * of mail but account mail stops (`email_kind_suppressible`), so what still goes is named.
   */
  undeliverable: (address: string, reason: 'hard_bounce' | 'complaint') =>
    `${
      reason === 'hard_bounce'
        ? `We could not deliver to ${address}`
        : `Mail to ${address} was reported as spam`
    }, so only sign-in links and mail about the account are sent to it now.`,
  dangerTitle: 'Danger',
  deleteLabel: 'Delete this account',
  /** FACTS E6: the undo within the restore window, by the restore link (owner ruling, CC-27b Q16). */
  deleteText: (sites: number, grace: number) =>
    `${
      sites === 0
        ? 'Removes the account and its reports'
        : sites === 1
          ? 'Removes the site, its history and reports'
          : sites === 2
            ? 'Removes both sites, their history and reports'
            : `Removes all ${numberWord(sites)} sites, their history and reports`
    }. Takes effect after a confirmation link. For ${numberWord(grace)} days the restore link in that email undoes it; after that the account is erased, apart from the few things the confirmation page lists.`,
  deleteAction: 'Delete…',
  /** The confirmation step (owner ruling 12). */
  deleteSteps: (what: string, email: string, grace: number) =>
    `Type the ${what} below and we send a confirmation link to ${email}. The link opens a page where you confirm the deletion; sign-in then stops at once, and for ${numberWord(grace)} days the restore link in the same email restores the account.`,
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
  noCardTerms: (plan: string, plansOpen = true) =>
    plansOpen
      ? `No card on file; nothing is charged unless you add one and choose ${plan}.`
      : 'No card on file; nothing is charged.',
  /** A card taken at Checkout whose last four digits were not recorded is named without them. */
  cardTerms: (last4: string | null) =>
    `The card ${last4 === null ? 'on file' : `ending ${last4}`} is charged then unless you cancel.`,
  freeNote: (schedule: string, fixes: number) =>
    `One site, ${schedule} checks, the ${numberWord(fixes)} largest fixes of each audit.`,
  sitesUsed: 'Sites',
  pagesUsed: 'Pages crawled, largest site',
  of: (n: number, of: number) => `${count(n)} of ${count(of)}`,
  keep: (plan: string, price: number) => `Keep ${plan}, $${price} a month`,
  choose: (plan: string, price: number) => `Choose ${plan}, $${price} a month`,
  /** In place of Keep or Choose while paid plans are not open (F-108); `until` is a trial's end. */
  plansOpenSoon: (until: string | null) =>
    until === null
      ? 'Paid plans open shortly.'
      : `Paid plans open shortly. Your trial runs to ${until}.`,
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
  /** FACTS D5 (two clicks). */
  cancelTrialClosed:
    'Nothing to cancel on a trial; it ends by itself. Nothing you can see is deleted.',
  /** While paid plans are closed the cancel route answers 404, so the way to cancel is a person. */
  cancelByEmail: `To cancel, email ${SUPPORT_EMAIL}.`,
  cancelTrial: (clicks: number) =>
    `Nothing to cancel on a trial; it ends by itself. On Pro or Agency, "Cancel, back to Free" sits here: ${numberWord(clicks)} clicks, effective at the end of the paid month. Nothing you can see is deleted.`,
  /** A trial with a card becomes the plan at its end unless it is cancelled (ARCH-2 §3.1). */
  cancelCardTrial: (date: string, clicks: number) =>
    `The trial ends ${date} and the card is charged unless you cancel: ${numberWord(clicks)} clicks, effective when the trial ends. Nothing you can see is deleted.`,
  cancelPaid: (clicks: number, period: 'month' | 'year') =>
    `${capitalise(numberWord(clicks))} clicks, effective at the end of the paid ${period}. Nothing you can see is deleted.`,
  /** A plan whose payment failed is cancelled at once (lib/billing/cancel.ts, `AT_ONCE`). */
  cancelAtOnce: (clicks: number) =>
    `${capitalise(numberWord(clicks))} clicks, effective at once. Nothing you can see is deleted.`,
  cancelAction: 'Cancel, back to Free',
  /**
   * Cancel's second click (CC-39 D1): what ends and when, as lib/billing/cancel.ts ends it — a paid
   * plan at its period's end, a trial with a card at the trial's end, a past-due plan at once.
   */
  confirmPeriodEnd: (plan: string, date: string | null) =>
    `${plan} runs ${date === null ? 'to the end of the paid period' : `until ${date}`}, then the account is on Free and nothing more is charged.`,
  confirmTrial: (plan: string, date: string) =>
    `The ${plan} trial runs until ${date}, then the account is on Free and the card is not charged.`,
  confirmNow: (plan: string) => `${plan} ends now, and the account is on Free.`,
  confirmAction: (plan: string) => `Yes, cancel ${plan}`,
  /** A paid plan set to end at its period's end is shown until then (spec 27 "Cancel"). */
  cancelling: (plan: string, date: string) =>
    `${plan} until ${date}, then Free. Nothing more is charged.`,
  /** A trial with a card set to cancel at its end: the card is not charged. */
  /** Null digits: a card taken at Checkout whose last four were not recorded (CC-39 F8). */
  trialCancelling: (plan: string, date: string, last4: string | null) =>
    `${plan} trial until ${date}, then Free. The card ${last4 === null ? 'on file' : `ending ${last4}`} is not charged.`,
  /** The same, for a reader the card's digits are withheld from (CC-37 Q25). */
  trialCancellingWithheld: (plan: string, date: string) =>
    `${plan} trial until ${date}, then Free. The card is not charged.`,
  trialCancelled: (date: string) =>
    `Cancelled; the trial ends ${date} and the card is not charged.`,
  cancelled: (date: string) =>
    `Cancelled; it takes effect ${date}. Nothing you can see is deleted.`,
  cancelFree: 'Nothing to cancel on Free.',
  receipts: 'Receipts',
  /** FACTS A9. */
  receiptsText: 'Emailed by Stripe after each charge, and listed in the billing portal from here',
  /** Before any charge there is no Stripe customer, so no portal to list them in. */
  noReceipts: 'Emailed by Stripe after each charge; there has been no charge yet.',
  receiptsClosed: 'Emailed by Stripe after each charge.',
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

/** The account name's hint as Final-Settings locked it. */
const NAME_HINT_LOCKED = 'Shown on sign-in links and, on Agency, on client reports.';

/**
 * Every reading of the name hint that differs from the locked one, rendered from `nameHint` over
 * each plan and switch state. The locked fixture (a Pro trial, the switch showing) reaches one; the
 * rest are listed as `otherReading`, which the lock comparison does not apply.
 */
export const NAME_HINT_CHANGES: CopyChange[] = (() => {
  const seen = new Set<string>();
  const out: CopyChange[] = [];
  for (const agency of [false, true]) {
    for (const reportsShown of [true, false]) {
      const rendered: string = SETTINGS_COPY.nameHint({ agency, reportsShown });
      if (rendered === NAME_HINT_LOCKED || seen.has(rendered)) continue;
      seen.add(rendered);
      out.push({
        screen: 'settings',
        kind: 'ruling',
        locked: NAME_HINT_LOCKED,
        rendered,
        source: `V2R register, row 24 (CTO 085): the hint names where the account name is shown today, sign-in links and client-report mail; no client report reads the brand name yet. This reading: ${agency ? 'Agency' : 'not Agency'}, agency_white_label ${reportsShown ? 'shown' : 'hidden'}`,
        ...(!agency && reportsShown ? {} : { otherReading: true }),
      });
    }
  }
  return out;
})();

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
  ...NAME_HINT_CHANGES,
  {
    screen: 'settings',
    kind: 'fixture',
    locked: 'Save Email changed, not yet saved',
    rendered: 'Save',
    source:
      'The fixture’s account address is you@company.com: the locked page shows an edit in progress, which the preview, filled from the account, does not',
  },
  // The locked sender, corrected while the sign-in link comes from another.
  ...(SIGNIN_SENDER === SIGNIN_SENDER_LOCKED
    ? []
    : [
        {
          screen: 'settings' as const,
          kind: 'facts' as const,
          locked: SIGNIN_SENDER_LOCKED,
          rendered: SIGNIN_SENDER,
          source:
            'FACTS correction (CC-25 ruling 8, CC-27 D8; CC-28 Q5): the page names SIGNIN_SENDER, Supabase’s SMTP sender, until the owner moves it to signin@ at switch-on (docs/ops/senders.md)',
        },
      ]),
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
      'Takes effect after a confirmation link. For seven days the restore link in that email undoes it; after that the account is erased, apart from the few things the confirmation page lists.',
    source:
      'FACTS E6, as CC-27b built it and the owner approved (CC-27b Q16, 2026-11-11): the restore link restores, a sign-in link cannot once sign-in is stopped, and the erasure keeps what the confirmation page lists',
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
    rendered: `Agency, ${formatPlanPrice('agency')} a month`,
    source: `Owner ruling of 2026-11-03: the Agency list price is ${formatPlanPrice('agency')} (lib/billing/prices.ts, CC-27 D8)`,
  },
  {
    screen: 'settings',
    kind: 'facts',
    locked: 'one click, effective at the end of the paid month, nothing deleted.',
    rendered: 'two clicks, effective at the end of the paid month. Nothing you can see is deleted.',
    source:
      'FACTS A6 and D5 (two clicks). The sentence about condensing evidence is out: no job does it (CTO ruling, 2026-11-22)',
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

export const SETTINGS_ADDITIONS: Addition[] = [
  {
    screen: 'settings',
    what: 'A line under the email kinds when mail to the reader’s own address hard-bounced or was reported as spam, saying that only sign-in links and account mail go to it now',
    source: 'CC-28 D7 (Resend’s bounces and complaints suppress all but account mail)',
  },
  {
    screen: 'settings',
    what: 'A line under the cards, “A question about this account? Email support”: a mailto to the support address whose body carries the account’s id and the page’s path',
    source: 'CC-33 D5 (lib/v2/support/mailto.ts)',
  },
  {
    screen: 'settings',
    what: 'A Branding card for an Agency account’s owner or account manager while the Goal 1 switch shows `agency_white_label`: the brand name with the route’s rule, the current logo or “No logo yet”, a logo file input with the validator’s formats and limits, and one save posting to `/api/agency/brand`',
    source: 'V2R register, row 24 (CTO 085)',
  },
];
