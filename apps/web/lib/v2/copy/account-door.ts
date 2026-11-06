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
  'FACTS correction (CC-25 D6): nothing starts a check until CC-20b sets V2_PIPELINE=1, so the page says the site is attached, not that its audit starts.';

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
    rendered: 'If you name one, it becomes your first site when you open the sign-in link.',
    source: PIPELINE,
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
    locked: '$69 a month',
    rendered: '$99 a month',
    source:
      'FACTS correction (CC-25 D7): the project decision of 2026-11-03 sets the Agency list price at $99 a month.',
  },
  // ── Check-email, from an audit ────────────────────────────────────────────────────────────
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
    locked: 'is re-checked weekly for 14 days and monthly after;',
    rendered: 'is re-checked weekly for 14 days if it is your first trial, and monthly after;',
    source: FIRST_TRIAL,
  },
  {
    screen: 'check-email',
    kind: 'facts',
    locked: 'The link opens your dashboard with this audit as its first site.',
    rendered:
      'Opened in this browser, the link opens your dashboard with this audit as its first site.',
    source: SAME_BROWSER,
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
      'Opening the link creates your account and starts 14 days of Pro if it is your first trial.',
    source: FIRST_TRIAL,
  },
  {
    screen: 'check-email-no-audit',
    kind: 'facts',
    locked:
      'The first audit of acme-outdoors.com starts the moment you open it, about two minutes; after that it is re-checked weekly for 14 days and monthly, and if a check finds a change the note comes from',
    rendered:
      'acme-outdoors.com becomes your first site when you open it; it is re-checked weekly for 14 days if it is your first trial, and monthly after; if a check finds a change, the note comes from',
    source: `${PIPELINE} ${FIRST_TRIAL.replace('FACTS correction ', '')}`,
  },
  {
    screen: 'check-email-no-audit',
    kind: 'facts',
    locked: 'The link opens your dashboard with acme-outdoors.com as its first site.',
    rendered:
      'Opened in this browser, the link opens your dashboard with acme-outdoors.com as its first site.',
    source: SAME_BROWSER,
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
