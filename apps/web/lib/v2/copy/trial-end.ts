/**
 * Trial ending's written sentences (Final-TrialEnd): every number a parameter the view model counts
 * from the account's rows. The lock corrections for the artboard follow.
 */
import type { Addition, CopyChange } from '../copy-registry';
import { listOf } from '../format';
import { capitalise, count, numberWord, plural } from '../words';

export const TRIAL_END_COPY = {
  title: (days: number, plan: string) =>
    `${capitalise(numberWord(days))} ${plural(days, 'day', 'days')} of ${plan} left`,
  sites: (n: number) => `${count(n)} ${plural(n, 'site', 'sites')}`,
  lastCheck: (when: string) => `last check ${when}`,
  today: (time: string) => `today ${time}`,
  trialEnds: (date: string) => `trial ends ${date}`,
  runCheck: 'Run an audit now',
  bannerTitle: (plan: string, date: string) =>
    `${plan} ends ${date}. Here is exactly what changes, and what doesn't.`,
  /**
   * When the reminder is due, never that it was sent: nothing records a send until CC-28's mailer.
   * Shown while the reminder is on and its day has not passed.
   */
  reminderDue: (date: string) => `The reminder is due once, on ${date}.`,
  noCard: 'No card is on file, so nothing is charged either way.',
  /** A trial with a card on file becomes the plan at its end unless it is cancelled (ARCH-2 §3.1). */
  card: (last4: string, date: string) =>
    `The card ending ${last4} is charged on ${date} unless you cancel.`,
  /** A card trial set to cancel at its end: not charged (CC-27b review, item 1). */
  cardCancelled: (last4: string, date: string) =>
    `The trial is cancelled: it ends on ${date} and the card ending ${last4} is not charged.`,
  cancelledKeepText: (last4: string, date: string) =>
    `The trial ends on ${date} and the card ending ${last4} is not charged.`,
  keepNoCard: (plan: string, price: number) => `Keep ${plan}, $${price} a month · add a card`,
  letItEnd: (date: string) => `Let it end on ${date}`,
  cancelBefore: (date: string) => `Cancel before ${date}`,
  staysTitle: 'Stays, on Free',
  pausesTitle: (plan: string) => `Pauses, until ${plan}`,
  stays: {
    site: (schedule: string, email: boolean) =>
      `${schedule} checks${email ? ', email if changed' : ''}`,
    evidence: 'Every check, every audit, the evidence',
    /** FACTS A6, long form. */
    kept: (condensed: number) =>
      `kept; evidence older than ${condensed} days is condensed to headers and the parts of pages that changed`,
    freeFixes: (numbers: readonly number[]) =>
      `${plural(numbers.length, 'Fix', 'Fixes')} ${listOf(numbers.map(String))}, the free ${numberWord(numbers.length)}`,
    packetsOpen: 'packets stay open',
    publicLink: 'Public audit link',
    keepsWorking: 'keeps working',
    alerts: (host: string) => `Alerts on ${host}`,
    alertsBy: (schedule: string) => `still sent by email, after each ${schedule} check`,
  },
  pauses: {
    sitesHow: 'no checks; history kept, nothing you can see deleted',
    stagingHow: 'no deploy checks on Free; history kept',
    fixes: (range: string, n: number, plan: string) =>
      `${plural(n, 'Fix', 'Fixes')} ${range}, ${numberWord(n)} on ${plan}`,
    fixesHow: (packets: number) =>
      `listed, ${count(packets)} ${plural(packets, 'packet', 'packets')} closed`,
    features: {
      weekly: 'Weekly checks',
      slack: 'Slack alerts',
      competitor: 'competitor',
      exports: 'exports',
    },
    featuresHow: 'off; email alerts continue',
    featuresOff: 'off',
  },
  didTitle: (plan: string, days: number) =>
    `What ${plan} did for you in ${count(days)} ${plural(days, 'day', 'days')}`,
  didSub: (from: string, to: string) => `${from} to ${to}`,
  checksRun: 'Checks run',
  checksOn: (n: number, host: string, dates: readonly string[]) =>
    `${count(n)} on ${host}: ${listOf(dates)}`,
  recheck: (date: string, fix: number | null) =>
    fix === null ? `the re-check ${date}` : `the re-check ${date} after fix ${fix}`,
  /** "8 across the other four sites": the sites those checks ran on, counted from the checks. */
  checksElsewhere: (n: number, sites: number, staging: number) => {
    const copies = staging === 1 ? 'the staging copy' : `${numberWord(staging)} staging copies`;
    return `${count(n)} across ${
      sites
        ? `the other ${numberWord(sites)} ${plural(sites, 'site', 'sites')}${staging ? ` and ${copies}` : ''}`
        : copies
    }`;
  },
  changesCaught: 'Changes caught',
  blocked: (uas: readonly string[], date: string) => `${listOf(uas)} blocked ${date}`,
  after: (where: string, when: string) => `after ${where} changed ${when}`,
  fixesClosed: 'Fixes closed',
  closedDetail: (where: string, host: string, date: string, moves: readonly string[]) =>
    [`${where} on ${host}, ${date}`, ...moves].join(' · '),
  openWithPackets: 'Fixes open with packets',
  openDetail: (free: number, close: number, noPacket: number) =>
    `${count(free)} stay open on Free; ${count(close)} close.${
      noPacket
        ? ` ${count(noPacket)} more open ${plural(noPacket, 'fix has', 'fixes have')} no packet.`
        : ''
    }`,
  none: 'none',
  keepTitle: (plan: string) => `If you keep ${plan}`,
  doNothingTitle: 'If you do nothing',
  /** FACTS A6 (long form), D5 (two clicks) and A9 (Stripe emails the receipts). */
  terms: (clicks: number, condensed: number) =>
    `Cancel any day from Settings, in ${numberWord(clicks)} clicks; the account goes back to Free. Nothing you can see is deleted; evidence older than ${condensed} days is condensed to headers and the parts of pages that changed. Stripe emails the receipts; they are also in Settings › Plan.`,
  /** Keeping a no-card trial is a checkout, which charges when it is made (`/api/billing/checkout`). */
  keepNoCardText: (monthly: number, yearly: number) =>
    `$${monthly} a month, or $${yearly} a year, charged when you choose it and then each month or year.`,
  keepCardText: (last4: string, price: number, date: string, period: 'month' | 'year') =>
    `The card ending ${last4} is charged $${price} on ${date}, then each ${period}.`,
  endTitle: 'If you let it end',
  cancelTitle: 'If you cancel',
  endNothing: (date: string) => `Nothing to do. On ${date} the account is Free:`,
  endCancel: (date: string, clicks: number) =>
    `Cancel before ${date} from Settings › Plan, in ${numberWord(clicks)} clicks, and on ${date} the account is Free:`,
  /** What Free keeps and pauses, from the sites and the free fixes the account holds. */
  endKeeps: (
    host: string,
    schedule: string,
    fixes: number,
    others: number,
    staging: boolean,
    plan: string,
  ) =>
    `${host} keeps its ${schedule} check${fixes ? ` and its ${numberWord(fixes)} ${plural(fixes, 'fix', 'fixes')}` : ''}.${
      others || staging
        ? ` ${
            others
              ? `The other ${numberWord(others)} ${plural(others, 'site pauses', 'sites pause')} with ${plural(others, 'its', 'their')} history kept${staging ? ', and so does the staging copy' : ''}`
              : 'The staging copy pauses with its history kept'
          }; add ${plan} any time to resume ${others ? 'them' : 'it'}.`
        : ''
    }`,
  /** After the end, on Free (CC-27b D8; ARCH-2 §5 "free after trial"). */
  ended: {
    title: (plan: string) => `Back on Free: the ${plan} trial ended`,
    banner: (plan: string, date: string) =>
      `${plan} ended ${date}. Here is what stays, and what is paused.`,
    sub: (plan: string) =>
      `Nothing you can see was deleted. Choose ${plan} any time to resume what is paused.`,
    choose: (plan: string, price: number) => `Choose ${plan}, $${price} a month`,
    pausesTitle: (plan: string) => `Paused, until ${plan}`,
  },
  tables: { stays: 'Stays', pauses: 'Pauses', did: 'Trial summary' },
  columns: { what: 'What', how: 'How', item: 'Item', value: 'Count', detail: 'Detail' },
};

// ── Where Trial ending differs from its locked HTML ──────────────────────────────────────────
// Applied in order by the lock comparison (__tests__/v2/trial-end.test.tsx).

const ZONE =
  'FACTS D4 and Q4 (owner ruling): dates and times in the account’s zone, America/Indiana/Indianapolis; the locked page wrote them in UTC';
const A8 =
  'FACTS A8: the screen is read at the reminder, three days before the end (5 Nov 02:41Z, Wed 4 Nov 21:41 in the account’s zone, where A8 wrote the UTC date, Thu 5 Nov)';

export const TRIAL_END_CHANGES: CopyChange[] = [
  {
    screen: 'trial-end',
    kind: 'ruling',
    locked: 'We sent this once, today, as promised.',
    rendered: 'The reminder is due once, on Wed 4 Nov.',
    source:
      'Owner ruling pending (CC-27b Q17): nothing records that the reminder was sent (CC-28 sends it), so the sentence says when it is due, and nothing once its day has passed',
  },
  {
    screen: 'trial-end',
    kind: 'facts',
    locked: '2 days left',
    rendered: '3 days left',
    source: A8,
  },
  {
    screen: 'trial-end',
    kind: 'facts',
    locked: 'Two days of Pro left',
    rendered: 'Three days of Pro left',
    source: A8,
  },
  {
    screen: 'trial-end',
    kind: 'facts',
    locked: 'Fri 6 Nov ·',
    rendered: 'Wed 4 Nov ·',
    source: A8,
  },
  {
    screen: 'trial-end',
    kind: 'fixture',
    locked: 'last check today 06:00',
    rendered: 'last check Fri 30 Oct 06:02',
    source:
      'The fixture’s last check is the weekly check of Fri 30 Oct, finished 10:02Z (06:02 in the account’s zone); it holds no check after its as_of',
  },
  {
    screen: 'trial-end',
    kind: 'fixture',
    locked: 'Fixes 1–3, the free three packets stay open · fix 0 closed Sat 31 Oct',
    rendered: 'Fixes 0, 1 and 2, the free three packets stay open',
    source:
      'The fixture’s free three at the weekly check are fixes 1, 2 and 0 (CC-22’s freeFixes, by rank); fix 0 is open, and no check of Sat 31 Oct is in the fixture',
  },
  {
    screen: 'trial-end',
    kind: 'ruling',
    locked:
      'nahltech.com, redbirdaviation.com, drivepei.ca, staging no checks; history kept, nothing deleted',
    rendered:
      'nahltech.com, redbirdaviation.com and drivepei.ca no checks; history kept, nothing you can see deleted staging.example-outfitter.dev no deploy checks on Free; history kept',
    source:
      'Owner ruling Q10 and CC-27 D7: the other primary sites pause (ARCH-2 §3.2), the staging copy is listed apart because Free has no staging (GATES.free.stagingAndDeployHooks); FACTS A6 for the wording',
  },
  {
    screen: 'trial-end',
    kind: 'facts',
    locked: 'the evidence kept',
    rendered:
      'the evidence kept; evidence older than 90 days is condensed to headers and the parts of pages that changed',
    source: 'FACTS A6 (long form): what Free keeps is what you can see',
  },
  {
    screen: 'trial-end',
    kind: 'fixture',
    locked: 'listed, packets closed',
    rendered: 'listed, 11 packets closed',
    source:
      'The fixture’s fixes 14 and 15 have no packet, so eleven of the thirteen fixes on Pro close a packet',
  },
  {
    screen: 'trial-end',
    kind: 'fixture',
    locked: 'Fixes 4–14, eleven on Pro',
    rendered: 'Fixes 3–15, thirteen on Pro',
    source:
      'The fixture’s weekly check has sixteen open fixes, 0 to 15; the free three aside, thirteen',
  },
  {
    screen: 'trial-end',
    kind: 'facts',
    locked: 'What Pro did for you in 12 days Sun 25 Oct to Fri 6 Nov',
    rendered: 'What Pro did for you in 11 days Sat 24 Oct to Wed 4 Nov',
    source: `${A8}; ${ZONE}: the trial began 25 Oct 02:41Z, Sat 24 Oct 22:41 there`,
  },
  {
    screen: 'trial-end',
    kind: 'fixture',
    locked:
      'Checks run 21 8 on example-outfitter.com: 25–29 Oct daily, Fri 30, the re-check Sat 31 after fix 0, and today · 13 across the other four sites',
    rendered:
      'Checks run 13 5 on example-outfitter.com: Mon 26 Oct, Tue 27 Oct, the re-check Wed 28 Oct after fix 2, Thu 29 Oct and Fri 30 Oct · 8 across the other three sites and the staging copy',
    source:
      'The fixture’s checks finished between the trial’s start and now: the first audit finished seven minutes before the trial began; fix 2’s re-check is recorded on its reopened event',
  },
  {
    screen: 'trial-end',
    kind: 'fixture',
    locked:
      'Changes caught 2 ClaudeBot blocked Fri 30 Oct, the morning after the robots.txt change · nahltech.com orphans resolved',
    rendered:
      'Changes caught 3 Claude-SearchBot and ClaudeBot blocked Fri 30 Oct, after robots.txt changed Thu 19:40 · nahltech.com: 3 orphan pages now linked',
    source:
      'The fixture’s weekly check opened two blocks (Claude-SearchBot and ClaudeBot) and nahltech.com’s check resolved its orphans, by its summary',
  },
  {
    screen: 'trial-end',
    kind: 'fixture',
    locked: 'robots.txt, Sat 31 Oct · AI visibility F 22 → D 41',
    rendered: '/blog/* on nahltech.com, Fri 30 Oct · Technical SEO B 79 → B+ 84',
    source:
      'The fixture’s one fix closed in the trial is nahltech.com’s fix 1, verified Fri 30 Oct; fix 0 is open (and FACTS A1 would make the label AI readability)',
  },
  {
    screen: 'trial-end',
    kind: 'fixture',
    locked: '3 stay open on Free; 11 close',
    rendered: '3 stay open on Free; 11 close. 2 more open fixes have no packet.',
    source: 'The fixture’s fixes 14 and 15 are open with no packet',
  },
  {
    screen: 'trial-end',
    kind: 'fixture',
    locked: 'charged on Sun 8 Nov and then monthly.',
    rendered: 'charged when you choose it and then each month or year.',
    source:
      'The contract’s keep route, `/api/billing/checkout`, opens a subscription with no trial end, so it charges when it is made; a yearly plan is billed each year, not monthly',
  },
  {
    screen: 'trial-end',
    kind: 'facts',
    locked:
      'Cancel any day from Settings; the account goes back to Free, nothing is deleted. Receipts are in Settings › Plan, not emailed.',
    rendered:
      'Cancel any day from Settings, in two clicks; the account goes back to Free. Nothing you can see is deleted; evidence older than 90 days is condensed to headers and the parts of pages that changed. Stripe emails the receipts; they are also in Settings › Plan.',
    source: 'FACTS A6 (long form), D5 (two clicks) and A9 (Stripe emails the receipts)',
  },
  {
    screen: 'trial-end',
    kind: 'ruling',
    locked: 'The other four sites pause with their history kept;',
    rendered: 'The other three sites pause with their history kept, and so does the staging copy;',
    source:
      'Owner ruling Q10: a staging site holds no primary slot, so three other sites, as the rail’s trial card counts them, and the staging copy apart',
  },
  {
    screen: 'trial-end',
    kind: 'facts',
    locked: 'Sun 8 Nov',
    rendered: 'Sat 7 Nov',
    source: `${ZONE}: trial_ends_at 8 Nov 02:41Z is Sat 7 Nov 21:41 there`,
    all: true,
  },
];

export const TRIAL_END_ADDITIONS: Addition[] = [];
