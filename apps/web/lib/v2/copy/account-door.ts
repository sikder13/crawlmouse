/**
 * The account door (CC-25): where Sign-up and Check-email differ from their locked HTML, and why.
 * Applied in order by the lock comparison (__tests__/v2/account-door-screens.test.tsx). Entries
 * whose source is a CC-25 decision use the `facts` kind: a decision that supersedes the screen.
 */
import type { Addition, CopyChange } from '../copy-registry';

const MASKED =
  'FACTS correction (CC-25 scope 3): Check-email shows the address masked, the local part shortened and the domain whole (lib/auth/mask-email.ts).';
const SENDER =
  'FACTS correction (CC-25 ruling 8): the sign-in link is sent from magic@ until CC-28 moves the Supabase template to signin@; the page names the sender that sends it (SIGNIN_SENDER).';
const FIRST_TRIAL =
  'FACTS correction (CC-25 ruling 8): the trial is decided by the ledger at first login, after this page is shown, so the trial sentence is conditional.';
const SAME_BROWSER =
  'FACTS correction (CC-25 known gap): the named site and the kept audit ride a cookie in the browser that asked for the link; opened on another device, the link signs in without them.';
const PIPELINE =
  'FACTS correction (CC-25 D6): nothing starts or repeats a check, and nothing sends a change note, until V2_CHECKS_PUBLIC=1, which waits on requestCheck being called from the claim route and Sign-up, scheduled checks, and CC-28 sending from alerts@; until then the page says the site is kept, not that it is audited or re-checked. With V2_CHECKS_PUBLIC=1 the locked sentence renders, with the room condition.';
const ANY_ACCOUNT =
  'FACTS correction (CC-25 review): Sign-up invites an existing account to use the same form, and a named site is added at any sign-in with room, so the sentence holds for a new account and an existing one; the trial comes only with a new account.';
const DASHBOARD =
  'FACTS correction (CC-25 review): the dashboard is v1 until CC-26 and shows no v2 site, so the page says the link keeps it, not that the dashboard shows it.';

export const ACCOUNT_DOOR_CHANGES: CopyChange[] = [
  // ── Sign-up ───────────────────────────────────────────────────────────────────────────────
  {
    screen: 'signup',
    kind: 'facts',
    locked: 'nothing is deleted when the 14 days end.',
    rendered: 'nothing you can see is deleted when the 14 days end.',
    source: 'FACTS A6',
  },
  {
    screen: 'signup',
    kind: 'facts',
    locked:
      'If you name one, its first audit starts the moment you open the sign-in link, about two minutes.',
    rendered:
      'If you name one, it is added to your account when you open the sign-in link, if the account has room for another site.',
    source: `${PIPELINE} ${ANY_ACCOUNT}`,
  },
  {
    screen: 'signup',
    kind: 'facts',
    locked: 'one reminder two days before the 14 days end.',
    rendered:
      'one reminder three days before the 14 days end. If you pay, Stripe sends the receipts.',
    source:
      'FACTS A8 (the reminder goes three days before, as ARCH-2 §3.2 schedules it: trial_ends_at − 3d) and A9 (receipts)',
  },
  {
    screen: 'signup',
    kind: 'facts',
    locked:
      'Running an audit right now? Keep it from the audit page instead and it becomes your first site.',
    rendered: '',
    source:
      'FACTS correction (CC-25 D6): no live page offers Keep until the result page is served publicly, with V2_CHECKS_PUBLIC=1, when the sentence renders.',
  },
  {
    screen: 'signup',
    kind: 'facts',
    locked: '$69 a month',
    rendered: '$99 a month',
    source:
      'FACTS correction (CC-25 D7): the project decision of 2026-11-03 sets the Agency list price at $99 a month.',
  },
  // ── Check-email, from an audit ────────────────────────────────────────────────────────────
  {
    screen: 'check-email',
    kind: 'facts',
    locked: 'Opening the link keeps the audit.',
    rendered: 'Opening the link keeps the audit, if the account has room for another site.',
    source:
      'FACTS correction (CC-25 review round 3): the claim is refused (site_limit) when the account already keeps as many sites as it may, as a Free account with one site does.',
  },
  {
    screen: 'check-email',
    kind: 'facts',
    locked: 'you@company.com',
    rendered: 'y…@company.com',
    source: MASKED,
  },
  {
    screen: 'check-email',
    kind: 'facts',
    locked: 'signin@crawlmouse.com',
    rendered: 'magic@crawlmouse.com',
    source: SENDER,
  },
  {
    screen: 'check-email',
    kind: 'facts',
    locked:
      'From then on, example-outfitter.com is re-checked weekly for 14 days and monthly after; if a check finds a change, the note comes from alerts@crawlmouse.com. Until you open it, the audit stays at its 24-hour link.',
    rendered: 'Until you open it, the audit of example-outfitter.com stays at its 24-hour link.',
    source: `${PIPELINE} With it, the re-check sentence also carries the first-trial condition: ${FIRST_TRIAL.replace('FACTS correction ', '')}`,
  },
  {
    screen: 'check-email',
    kind: 'facts',
    locked: 'The link opens your dashboard with this audit as its first site.',
    rendered:
      'Opened in this browser, the link signs you in and keeps this audit in your account, if the account has room for another site.',
    source: `${SAME_BROWSER} ${DASHBOARD.replace('FACTS correction ', '')}`,
  },
  // ── Check-email, a sign-up naming a site ──────────────────────────────────────────────────
  {
    screen: 'check-email-no-audit',
    kind: 'facts',
    locked: 'you@company.com',
    rendered: 'y…@company.com',
    source: MASKED,
  },
  {
    screen: 'check-email-no-audit',
    kind: 'facts',
    locked: 'signin@crawlmouse.com',
    rendered: 'magic@crawlmouse.com',
    source: SENDER,
  },
  {
    screen: 'check-email-no-audit',
    kind: 'facts',
    locked: 'Opening the link creates your account and starts 14 days of Pro.',
    rendered:
      'Opening the link creates your account, with 14 days of Pro if it is your first trial, or signs you in to the one you have.',
    source: `${FIRST_TRIAL} ${ANY_ACCOUNT.replace('FACTS correction ', '')}`,
  },
  {
    screen: 'check-email-no-audit',
    kind: 'facts',
    locked:
      'The first audit of acme-outdoors.com starts the moment you open it, about two minutes; after that it is re-checked weekly for 14 days and monthly, and if a check finds a change the note comes from alerts@crawlmouse.com.',
    rendered:
      'acme-outdoors.com is added to your account when you open it, if the account has room for another site.',
    source: `${PIPELINE} ${ANY_ACCOUNT.replace('FACTS correction ', '')}`,
  },
  {
    screen: 'check-email-no-audit',
    kind: 'facts',
    locked: 'The link opens your dashboard with acme-outdoors.com as its first site.',
    rendered:
      'Opened in this browser, the link signs you in and keeps acme-outdoors.com in your account, if the account has room for another site.',
    source: `${SAME_BROWSER} ${DASHBOARD.replace('FACTS correction ', '')}`,
  },
];

export const ACCOUNT_DOOR_ADDITIONS: Addition[] = [
  {
    screen: 'signup',
    what: 'The form’s error and status regions (empty until a send is refused, or waits for Turnstile)',
    source: 'CC-25 scope 1: the rate-limited, Turnstile and invalid-site states',
  },
  {
    screen: 'check-email',
    what: 'The resend’s error and status regions',
    source: 'CC-25 scope 3: "Send the link again" re-posts, and shows the 429 copy',
  },
  {
    screen: 'check-email-no-audit',
    what: 'The resend’s error and status regions',
    source: 'CC-25 scope 3',
  },
];
