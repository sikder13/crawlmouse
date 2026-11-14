/**
 * The help centre's twelve articles (CC-33 D4) as data, each titled as the reader's question. Their
 * numbers are read from the constants that own them (prices, GATES, the trial, the pipeline's and
 * the account's limits, the grade formulas), and a sentence that names a capability carries its
 * `CAPABILITIES` key, so a coming one renders its "coming" mark; both are held by
 * `pnpm --filter @crawlmouse/web exec vitest run __tests__/v2/help.test.tsx`. A point the code does
 * not establish is left out; where the tree disagrees with itself (questions.md Q7), the articles
 * state what the v2 product does.
 *
 * The articles are built when called, from the values the modules hold then.
 */
import { MIN_GRADEABLE_PAGES } from '@crawlmouse/types';
import type { WithheldReason } from '@crawlmouse/types/v2';
import {
  AUTH_LINK_MINUTES,
  RESEND_HINT_MINUTES,
  SIGNIN_SENDER,
  TRIAL_REMINDER_DAYS_BEFORE_END,
} from '../../auth/constants';
import { AGENCY_MONTHLY, AGENCY_YEARLY, PRO_MONTHLY, PRO_YEARLY, usd } from '../../billing/prices';
import { TRIAL_DAYS, type SubscriptionStatus } from '../../billing/state-machine';
import { GATES, type Tier } from '../../entitlement-v2';
import { MAGIC_LINK_PER_EMAIL_PER_HOUR } from '../../limits';
import { DELETE_COPY, deletionMoney, REFUND_POLICY } from '../copy/deletion';
import { CANCEL_CLICKS, SETTINGS_COPY } from '../copy/settings';
import { listOf } from '../format';
import { ANONYMOUS_EXPIRY_HOURS } from '../pipeline/limits';
import { CAPABILITIES, type CapabilityKey } from '../view/agencies';
import { AI_WAITING } from '../view/effect-headline';
import { SEGMENT_KEYS, SEGMENTS } from '../view/segment/frame';
import { capitalise, count, numberWord, plural } from '../words';
import {
  AI_WEIGHTS,
  CRAWL_USER_AGENT,
  CRAWLER_TAG,
  FROM_HEADER,
  OUR_ROBOTS_TOKENS,
  RECHECK_WINDOW_HOURS,
  SCORED_SIGNALS,
  SEO_WEIGHTS,
  VERDICT_LABELS,
} from './pinned';
import { HELP_QUESTIONS, type HelpSlug } from './questions';

/** One sentence and the capabilities it names; `coming` when one of them is not built. */
export interface HelpSentence {
  text: string;
  capabilities: readonly CapabilityKey[];
  coming: boolean;
}

export type HelpBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; sentences: HelpSentence[] }
  | { kind: 'list'; items: HelpSentence[] }
  | { kind: 'code'; lines: string[] }
  /** A link to another article. */
  | { kind: 'see'; slug: HelpSlug };

export interface HelpArticle {
  slug: HelpSlug;
  /** The reader's question: the page's title and its h1. */
  question: string;
  description: string;
  blocks: HelpBlock[];
}

/** A sentence, tagged with the capabilities it names. */
function s(text: string, ...capabilities: CapabilityKey[]): HelpSentence {
  return {
    text,
    capabilities,
    coming: capabilities.some((k) => CAPABILITIES[k].status === 'coming'),
  };
}

const p = (...sentences: HelpSentence[]): HelpBlock => ({ kind: 'paragraph', sentences });
const list = (...items: HelpSentence[]): HelpBlock => ({ kind: 'list', items });
const see = (slug: HelpSlug): HelpBlock => ({ kind: 'see', slug });
const quote = (text: string) => `“${text}”`;

/**
 * What the trial ledger decides (lib/auth/trial-decision.ts; spec 06c's ledger rule): a refused
 * trial leaves the new account on Free.
 */
const TRIAL_ONCE =
  'The trial is offered once: our trial record refuses it to an email that has had one recently, and can refuse it to a device or network that has had more than one, and the account then stays on Free.';

const cadence = (tier: Tier) => (GATES[tier].schedule === 'weekly' ? 'weekly' : 'monthly');
const times = (n: number, unit: string, units: string) => `${count(n)} ${plural(n, unit, units)}`;

/** Readers' names for the parts of the two grades. */
const AI_PARTS: Record<keyof typeof AI_WEIGHTS, [string, string]> = {
  access: ['Access', 'how much of each scored AI crawler’s sample of pages it was served'],
  readable: ['Readable', 'the share of a page’s words it serves without JavaScript'],
  quotable: ['Quotable', 'the content checks that count toward the grade'],
  signals: ['Signals', 'the declarations below'],
};
const SEO_PARTS: Record<keyof typeof SEO_WEIGHTS, [string, string]> = {
  structure: ['Site structure', 'how the pages that answer are linked to one another'],
  crawlability: [
    'Crawlability',
    'the share of crawled addresses that answer with a page and carry no defect such as a redirect chain or a missing title',
  ],
};
const SIGNAL_NAMES: Record<(typeof SCORED_SIGNALS)[number], string> = {
  schema_org: 'schema.org markup',
  content_signals: 'Content Signals in robots.txt',
};
/** The reasons that withhold AI readability itself; the others are a fix's own. */
const GRADE_WITHHELD: readonly WithheldReason[] = [
  'too_few_crawlers_measured',
  'blocked_by_choice',
  'readable_unmeasured',
  'quotable_unmeasured',
  'signals_unmeasured',
];

function whatAnAuditMeasures(): HelpArticle {
  const sections = listOf(SEGMENT_KEYS.map((k) => SEGMENTS[k].title));
  const free = GATES.free.fixesVisible;
  return {
    slug: 'what-an-audit-measures',
    question: HELP_QUESTIONS['what-an-audit-measures'],
    description: 'The two grades an audit gives, the sections of its result, and what is scored.',
    blocks: [
      p(
        s('An audit gives your site two grades: AI readability and Technical SEO.', 'free_audit'),
        s(
          'AI readability asks whether AI crawlers can fetch your pages and read them. Technical SEO asks how well your pages are linked and how cleanly they answer.',
        ),
      ),
      p(s(`The result is split into sections: ${sections}.`)),
      p(
        s(
          'Some of what an audit shows does not count toward a grade. The AI crawlers that collect training data are listed; the AI search crawlers are the ones scored.',
        ),
        s(
          `Of the agent-readiness signals, ${listOf(SCORED_SIGNALS.map((k) => SIGNAL_NAMES[k]))} add points; the others are listed as experimental.`,
        ),
      ),
      p(
        s('Each fix states its estimated effect on a grade, or why it is not estimated yet.'),
        typeof free === 'number'
          ? s(
              `On Free, the ${numberWord(free)} largest fixes of each audit are open, with the steps to make them.`,
              'fix_packets',
            )
          : s(
              'On Free, the fixes of each audit are open, with the steps to make them.',
              'fix_packets',
            ),
      ),
      see('how-grades-are-calculated'),
    ],
  };
}

function howGradesAreCalculated(): HelpArticle {
  const part = ([name, what]: [string, string], weight: number) =>
    s(`${name}, up to ${weight} points: ${what}.`);
  return {
    slug: 'how-grades-are-calculated',
    question: HELP_QUESTIONS['how-grades-are-calculated'],
    description:
      'The parts of AI readability and Technical SEO, their weights, and when a grade is withheld.',
    blocks: [
      { kind: 'heading', text: 'AI readability' },
      p(s(`AI readability adds ${numberWord(Object.keys(AI_WEIGHTS).length)} parts:`)),
      list(
        ...(Object.keys(AI_WEIGHTS) as (keyof typeof AI_WEIGHTS)[]).map((k) =>
          part(AI_PARTS[k], AI_WEIGHTS[k]),
        ),
      ),
      p(
        s(`The declarations that score are ${listOf(SCORED_SIGNALS.map((k) => SIGNAL_NAMES[k]))}.`),
      ),
      { kind: 'heading', text: 'Technical SEO' },
      p(s(`Technical SEO adds ${numberWord(Object.keys(SEO_WEIGHTS).length)} parts:`)),
      list(
        ...(Object.keys(SEO_WEIGHTS) as (keyof typeof SEO_WEIGHTS)[]).map((k) =>
          part(SEO_PARTS[k], SEO_WEIGHTS[k]),
        ),
      ),
      { kind: 'heading', text: 'When a grade is withheld' },
      p(
        s(
          'When a part cannot be measured, the grade is withheld rather than guessed, and the result says why. For AI readability it says one of these:',
        ),
      ),
      list(...GRADE_WITHHELD.map((r) => s(`${AI_WAITING[r]}.`))),
      p(
        s(
          `Technical SEO is not graded when the audit has too little to grade, for example fewer than ${numberWord(MIN_GRADEABLE_PAGES)} pages it could grade.`,
        ),
      ),
    ],
  };
}

function crawlerShownAsBlocked(): HelpArticle {
  return {
    slug: 'crawler-shown-as-blocked',
    question: HELP_QUESTIONS['crawler-shown-as-blocked'],
    description:
      'What the audit sent as each AI crawler, what “blocked” means in it, and how to check it yourself.',
    blocks: [
      p(
        s(
          `To test an AI crawler, the audit requests a sample of your pages with that crawler’s user agent, sent from our servers with our tag added: ${quote(CRAWLER_TAG)}.`,
        ),
        s('It reports what each request got back.'),
      ),
      p(
        s(
          `The audit says blocked in two cases: ${quote(VERDICT_LABELS.disallowed_by_robots)}, when your robots.txt disallows that crawler, and ${quote(VERDICT_LABELS.blocked_by_ua_rule)}, when a page refused that crawler’s user agent while it served another crawler the audit sent to the same page.`,
        ),
        s(
          'A crawler your robots.txt disallows is your choice, so it is left out of the AI readability score rather than counted against it.',
        ),
      ),
      p(
        s(
          `When a page refuses everything that claims to be a crawler, the audit cannot tell a rule about that crawler from a rule about who is asking. It then says ${quote(VERDICT_LABELS.refused_unverified)} and leaves that page out of the crawler’s score.`,
        ),
      ),
      p(
        s(
          'A rule that refuses crawlers by user agent is often set in a CDN or a firewall in front of the site, rather than in the site itself.',
        ),
      ),
      p(
        s(
          'Where the audit opens a fix for a blocked crawler, its steps end with a command under Verify that you can run from your own machine. It sends the request with the crawler’s own user agent.',
          'fix_packets',
        ),
        s(
          `Our request differs from it: it carries our tag after the user agent and a ${FROM_HEADER} header, and it comes from our servers. A rule that matches the exact user-agent string, reads the ${FROM_HEADER} header, or looks at where a request comes from can answer the two differently.`,
        ),
      ),
      see('how-we-crawl'),
    ],
  };
}

function fixStillOpen(): HelpArticle {
  const free = GATES.free.manualChecksPerSiteDay;
  const pro = GATES.pro.manualChecksPerSiteDay;
  const paidSame = pro === GATES.agency.manualChecksPerSiteDay;
  return {
    slug: 'fix-still-open',
    question: HELP_QUESTIONS['fix-still-open'],
    description:
      'What marking a fix done starts, what the re-check decides, and why a fix can stay open.',
    blocks: [
      p(
        s('Marking a fix done starts a re-check of the site.'),
        s(
          `It counts toward the site’s re-checks, which are counted over the last ${count(RECHECK_WINDOW_HOURS)} hours rather than by calendar day: ${
            paidSame
              ? `${count(free)} on Free, ${count(pro)} on Pro and Agency.`
              : `${count(free)} on Free, ${count(pro)} on Pro and ${count(GATES.agency.manualChecksPerSiteDay)} on Agency.`
          }`,
        ),
      ),
      list(
        s('If the re-check no longer finds the problem, the fix is verified and closes.'),
        s('If it still finds the problem, the fix opens again.'),
        s('If it could not measure the problem, the fix says it could not be verified.'),
      ),
      p(
        s(
          'If the site’s re-checks are used up, or a check of the site is already running, the fix stays marked done and the next check of the site measures it.',
          'weekly_checks',
        ),
      ),
      p(
        s(
          'The re-check reads what your site serves at that moment, at the address you audited. A change that is not live there yet, or a cache that still serves the old page, reads as not fixed.',
        ),
        s(
          'The re-check is an ordinary check of the site, not a request for the fix’s pages alone, and the fix is judged from the pages that check reads, as on any other check.',
        ),
      ),
    ],
  };
}

function auditExpired(): HelpArticle {
  return {
    slug: 'audit-expired',
    question: HELP_QUESTIONS['audit-expired'],
    description: 'How long an audit nobody keeps can be read, and how to keep one.',
    blocks: [
      p(
        s(
          `An audit nobody keeps can be read for ${times(ANONYMOUS_EXPIRY_HOURS, 'hour', 'hours')} after it was requested. After that, its link says it has expired.`,
          'free_audit',
        ),
      ),
      p(
        s(
          'To keep an audit, use “Keep this audit” on its result. One email creates a free account and keeps the site, which is then checked on its plan’s schedule.',
          'weekly_checks',
        ),
        s(`The new account also starts ${TRIAL_DAYS} days of Pro. ${TRIAL_ONCE}`),
      ),
      p(s('A new audit from the home page reads the site again, as it is now.', 'free_audit')),
    ],
  };
}

function signInEmail(): HelpArticle {
  return {
    slug: 'sign-in-email',
    question: HELP_QUESTIONS['sign-in-email'],
    description: 'Where the sign-in link comes from, how long it works, and how to ask again.',
    blocks: [
      p(
        s(`Sign-in links come from ${SIGNIN_SENDER}.`),
        s(
          `A link works once, for ${count(AUTH_LINK_MINUTES)} minutes, and asking for a new one replaces it.`,
        ),
      ),
      p(
        s(
          `Give it ${times(RESEND_HINT_MINUTES, 'minute', 'minutes')}, then look in your spam or junk folder, and in any quarantine your company’s mail filter keeps.`,
        ),
        s(
          `Adding ${SIGNIN_SENDER} to your contacts or to the filter’s allow list helps the next one arrive.`,
        ),
      ),
      p(
        s(
          `A link can be asked for ${times(MAGIC_LINK_PER_EMAIL_PER_HOUR, 'time', 'times')} an hour for one email; after that, wait before asking again.`,
        ),
      ),
    ],
  };
}

function trials(): HelpArticle {
  const fixes = GATES.free.fixesVisible;
  const fixWords = typeof fixes === 'number' ? numberWord(fixes) : null;
  return {
    slug: 'trials',
    question: HELP_QUESTIONS['trials'],
    description: 'The Pro and Agency trials, what each asks for, and what happens at their end.',
    blocks: [
      p(
        s(
          `Pro’s trial needs no card: its ${TRIAL_DAYS} days start with your email when you first sign in. ${TRIAL_ONCE}`,
        ),
        s('When the trial ends, the account goes back to Free unless you have chosen Pro.'),
      ),
      p(
        s(
          `Agency’s trial lasts ${TRIAL_DAYS} days and takes a card at the start, and the plan is charged when the trial ends unless you cancel.`,
          'agency_trial',
          'cancel',
        ),
      ),
      p(
        s(
          `We email you ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before a trial ends.`,
          'trial_reminder',
        ),
      ),
      { kind: 'heading', text: 'Back on Free' },
      list(
        s(
          fixWords
            ? `Your first site keeps ${cadence('free')} checks, the ${fixWords} largest fixes of each audit, and its full history.`
            : `Your first site keeps ${cadence('free')} checks and its full history.`,
          'weekly_checks',
          'fix_packets',
        ),
        s('Other sites pause until you choose Pro or remove them; their history stays.', 'sites'),
        ...(fixWords
          ? [
              s(
                `Fixes beyond the first ${fixWords} stay listed with their estimated effect, and their steps open again with Pro.`,
                'fix_packets',
              ),
            ]
          : []),
        s('Nothing you can see is deleted.'),
      ),
      see('cancel-and-refunds'),
    ],
  };
}

function cancelAndRefunds(): HelpArticle {
  return {
    slug: 'cancel-and-refunds',
    question: HELP_QUESTIONS['cancel-and-refunds'],
    description: 'Where cancelling is, when it takes effect, and the refund policy.',
    blocks: [
      p(
        s(
          `In ${SETTINGS_COPY.title} › ${SETTINGS_COPY.planTitle}, choose ${quote(SETTINGS_COPY.cancelAction)}. It takes ${numberWord(CANCEL_CLICKS)} clicks and no call.`,
          'cancel',
        ),
        s('The account’s owner sees that page; other members do not.'),
      ),
      p(
        s(
          'A paid plan carries on to the end of the month or year already paid for, then the account goes back to Free, and nothing more is charged.',
          'cancel',
        ),
      ),
      p(
        s(
          'A trial with a card that you cancel ends on its last day, and the card is not charged. An agency account can also cancel its trial from the Agency trial page.',
          'agency_trial',
          'cancel',
        ),
      ),
      p(s(`Refunds follow our Terms: ${quote(REFUND_POLICY)}`)),
      p(
        s(
          `Stripe emails a receipt after each charge, and the receipts are listed in the billing portal that ${SETTINGS_COPY.title} › ${SETTINGS_COPY.planTitle} opens.`,
        ),
      ),
      see('trials'),
    ],
  };
}

function otherToolsScores(): HelpArticle {
  return {
    slug: 'other-tools-scores',
    question: HELP_QUESTIONS['other-tools-scores'],
    description: 'Each tool grades its own question; what the Crawlmouse grades measure.',
    blocks: [
      p(
        s(
          'Each of those tools answers its own question with its own formula, so their scores are not on one scale with ours, or with each other’s.',
        ),
      ),
      p(
        s(
          'Crawlmouse asks whether AI crawlers can fetch and read your site, and how well its pages are linked and answer.',
        ),
        s(
          'It requests your pages as each AI crawler and compares what each was sent with what an ordinary browser gets.',
          'free_audit',
        ),
      ),
      p(s('Its grades do not include page speed, backlinks or search rankings.')),
      see('how-grades-are-calculated'),
    ],
  };
}

function howWeCrawl(): HelpArticle {
  const [ours, alias] = OUR_ROBOTS_TOKENS;
  return {
    slug: 'how-we-crawl',
    question: HELP_QUESTIONS['how-we-crawl'],
    description:
      'The user agents an audit sends, the robots.txt groups it obeys, and how to block it.',
    blocks: [
      p(s(`Our crawler’s user agent is ${quote(CRAWL_USER_AGENT)}.`)),
      p(
        s(
          `To test AI crawlers, an audit also requests a sample of pages as each crawler’s user agent with ${quote(CRAWLER_TAG)} added, and once per sampled page as an ordinary browser, which carries no tag.`,
        ),
        s(
          'When a page refuses a crawler, the audit may request it once more as Googlebot, tagged the same way, to see whether the refusal is about that crawler.',
        ),
      ),
      p(
        s(
          `Our requests obey the robots.txt groups named ${ours} and ${alias}, and the * group when your file has neither. A request sent as a crawler also obeys that crawler’s own group, and a page that group disallows is not requested.`,
        ),
      ),
      p(s(`To keep Crawlmouse out, add this group to your robots.txt:`)),
      { kind: 'code', lines: [`User-agent: ${ours}`, 'Disallow: /'] },
      p(
        s(
          'The audit still reads robots.txt itself, to learn the rule. To let Crawlmouse in where a broader group keeps bots out, give it a group that allows it:',
        ),
      ),
      { kind: 'code', lines: [`User-agent: ${ours}`, 'Allow: /'] },
      see('crawler-shown-as-blocked'),
    ],
  };
}

/** One plan's lines, from its gates. */
function planLines(tier: Tier): HelpSentence[] {
  const g = GATES[tier];
  const lines: HelpSentence[] = [
    s(
      tier === 'free'
        ? `${capitalise(numberWord(g.sites))} ${plural(g.sites, 'site', 'sites')}, checked ${cadence(tier)}.`
        : `${count(g.sites)} sites, each checked ${cadence(tier)}.`,
      'sites',
      'weekly_checks',
    ),
    s(`Up to ${count(g.pagesPerCheck)} pages read per check.`),
    g.fixesVisible === 'all'
      ? s('Every fix open, with the steps to make it.', 'fix_packets')
      : s(
          `The ${numberWord(g.fixesVisible)} largest fixes of each audit open, with the steps to make them.`,
          'fix_packets',
        ),
    s(
      `Up to ${count(g.manualChecksPerSiteDay)} re-checks a site in any ${count(RECHECK_WINDOW_HOURS)} hours, fixes marked done included.`,
    ),
  ];
  if (g.slack)
    lines.push(
      s(
        'A note by email or in Slack when a check finds a change.',
        'change_emails',
        'slack_alerts',
      ),
    );
  if (g.seats > 1) lines.push(s(`Seats for ${count(g.seats)} people.`, 'seats'));
  if (g.competitorsPerSite > 0)
    lines.push(
      s(
        `${count(g.competitorsPerSite)} ${plural(g.competitorsPerSite, 'competitor', 'competitors')} measured per site.`,
        'competitors',
      ),
    );
  if (g.exports) lines.push(s('Audits as PDF and JSON.', 'exports'));
  if (g.agencyBranding)
    lines.push(
      s(
        'Reports for clients under your own name, and a client report page on your domain.',
        'client_reports',
        'client_report_page',
      ),
    );
  return lines;
}

function plans(): HelpArticle {
  return {
    slug: 'plans',
    question: HELP_QUESTIONS['plans'],
    description:
      'What each plan includes, from the limits the product enforces, and what each costs.',
    blocks: [
      { kind: 'heading', text: 'Free' },
      p(s('Free costs nothing and needs no card.')),
      list(...planLines('free')),
      { kind: 'heading', text: 'Pro' },
      p(s(`${usd(PRO_MONTHLY)} a month, or ${usd(PRO_YEARLY)} a year.`)),
      list(...planLines('pro')),
      { kind: 'heading', text: 'Agency' },
      p(s(`${usd(AGENCY_MONTHLY)} a month, or ${usd(AGENCY_YEARLY)} a year.`)),
      list(...planLines('agency')),
      p(s(`Pro and Agency each have a ${TRIAL_DAYS}-day trial.`, 'agency_trial')),
      see('trials'),
    ],
  };
}

/** Every state Stripe gives a subscription; the Record holds the list complete. */
const SUBSCRIPTION_STATUSES: Record<SubscriptionStatus, true> = {
  trialing: true,
  active: true,
  past_due: true,
  canceled: true,
  unpaid: true,
  incomplete: true,
  incomplete_expired: true,
  paused: true,
};

/**
 * What `deletionMoney` says of the money for each subscription state, once each and in the order
 * first met; the refund policy it adds to each is said once, after them.
 */
function moneySentences(): string[] {
  const said = Object.keys(SUBSCRIPTION_STATUSES).flatMap((status) => {
    const money = deletionMoney(status);
    return money === null ? [] : [money[0]];
  });
  return [...new Set(said)];
}

function deleteAccount(): HelpArticle {
  return {
    slug: 'delete-account',
    question: HELP_QUESTIONS['delete-account'],
    description: 'Where deleting is, the days in which it can be undone, and what is kept.',
    blocks: [
      p(
        s(
          `In ${SETTINGS_COPY.title}, under ${SETTINGS_COPY.dangerTitle}, choose ${quote(SETTINGS_COPY.deleteLabel)}. Deleting is the account owner’s to do; other members have no button for it.`,
        ),
        s(
          `You type the account’s ${SETTINGS_COPY.hostnameNoun} or ${SETTINGS_COPY.emailNoun}, and we email a confirmation link.`,
        ),
        s(SETTINGS_COPY.retypeHint),
      ),
      list(...DELETE_COPY.what.map((line) => s(line))),
      p(...moneySentences().map((text) => s(text, 'cancel')), s(REFUND_POLICY)),
    ],
  };
}

/** The twelve articles, in the index's order. */
export function helpArticles(): HelpArticle[] {
  return [
    whatAnAuditMeasures(),
    howGradesAreCalculated(),
    crawlerShownAsBlocked(),
    fixStillOpen(),
    auditExpired(),
    signInEmail(),
    trials(),
    cancelAndRefunds(),
    otherToolsScores(),
    howWeCrawl(),
    plans(),
    deleteAccount(),
  ];
}
