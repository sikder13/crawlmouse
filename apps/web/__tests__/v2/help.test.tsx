/**
 * The help centre (CC-33 D4). Each page is rendered whole, shell and footer included:
 * - every run of digits it shows is a price, a limit or a figure the code that owns it holds;
 * - built again with each of those owners given another value, the pages show each new value as
 *   many times as the articles read its owner, and today's values only where the describe block
 *   "the figures follow the modules that own them" says (it names each owner, the quoted module
 *   whose sentences it rewrites, and what it leaves unaltered);
 * - each plan's feature lines follow its GATES, today's and with the switches set apart;
 * - the delete article says what `deletionMoney` says for each subscription state;
 * - every capability it names carries its `CAPABILITIES` key, a coming one with its mark, and its
 *   title and description, which a search result shows with no mark, name no coming capability;
 * - each page has one h1, its own canonical, title and description, and no FAQPage markup;
 * - with V2_CHECKS_PUBLIC off, the index and each article are 404s.
 */
import { MIN_GRADEABLE_PAGES } from '@crawlmouse/types';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpArticleScreen, HelpIndexScreen } from '../../components/v2/screens/help/HelpScreens';
import {
  AUTH_LINK_MINUTES,
  RESEND_HINT_MINUTES,
  TRIAL_REMINDER_DAYS_BEFORE_END,
} from '../../lib/auth/constants';
import * as PRICES from '../../lib/billing/prices';
import { TRIAL_DAYS, type SubscriptionStatus } from '../../lib/billing/state-machine';
import { GATES, type Tier, type TierGates } from '../../lib/entitlement-v2';
import { MAGIC_LINK_PER_EMAIL_PER_HOUR } from '../../lib/limits';
import { DELETE_COPY, deletionMoney, RESTORE_DAYS } from '../../lib/v2/copy/deletion';
import { CANCEL_CLICKS } from '../../lib/v2/copy/settings';
import { helpArticles, type HelpBlock } from '../../lib/v2/help/articles';
import { HELP_COPY } from '../../lib/v2/help/copy';
import {
  AI_WEIGHTS,
  CRAWL_USER_AGENT,
  CRAWLER_TAG,
  RECHECK_WINDOW_HOURS,
  SEO_WEIGHTS,
} from '../../lib/v2/help/pinned';
import { HELP_QUESTIONS, HELP_SLUGS, helpPath } from '../../lib/v2/help/questions';
import { helpArticleView, helpIndexView } from '../../lib/v2/help/view';
import { ANONYMOUS_EXPIRY_HOURS } from '../../lib/v2/pipeline/limits';
import { count, numberWord } from '../../lib/v2/words';
import { capabilitySweep, comingNamedIn } from '../helpers/capability-sweep';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The visible text of a page, without the user-agent strings, whose version digits are theirs. */
function textOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replaceAll(CRAWL_USER_AGENT, ' ')
    .replaceAll(CRAWLER_TAG, ' ');
}

const numbersIn = (text: string) =>
  [...text.matchAll(/\d{1,3}(?:,\d{3})+|\d+/g)].map((m) => Number(m[0].replace(/,/g, '')));

const numeric = (record: object) =>
  Object.values(record).filter((v): v is number => typeof v === 'number');

/** Numbers on the pages that are not a price or a gate, each with what it is. */
const NAMED: Record<string, number> = {
  'an unkept audit is readable this many hours': ANONYMOUS_EXPIRY_HOURS,
  'a sign-in link works this many minutes': AUTH_LINK_MINUTES,
  'wait this long before looking in spam': RESEND_HINT_MINUTES,
  'sign-in links an hour for one email': MAGIC_LINK_PER_EMAIL_PER_HOUR,
  'the trial reminder goes this many days before the end': TRIAL_REMINDER_DAYS_BEFORE_END,
  'cancelling takes this many clicks': CANCEL_CLICKS,
  'the restore link works this many days': RESTORE_DAYS,
  're-checks are counted over this many hours': RECHECK_WINDOW_HOURS,
  'Technical SEO needs this many gradeable pages': MIN_GRADEABLE_PAGES,
  'the footer’s copyright year': new Date().getFullYear(),
};

const ALLOWED = new Set<number>([
  ...numeric(PRICES),
  ...Object.values(GATES).flatMap(numeric),
  TRIAL_DAYS,
  ...numeric(AI_WEIGHTS),
  ...numeric(SEO_WEIGHTS),
  ...Object.values(NAMED),
]);

/** The help pages' addresses; each is rendered inside the test that reads it. */
const PATHS = ['/help', ...HELP_SLUGS.map(helpPath)];

function render(path: string): string {
  const slug = HELP_SLUGS.find((s) => helpPath(s) === path);
  return renderToStaticMarkup(
    slug ? (
      <HelpArticleScreen data={helpArticleView(slug)} />
    ) : (
      <HelpIndexScreen data={helpIndexView()} />
    ),
  );
}

const pages = (): [string, string][] => PATHS.map((p) => [p, render(p)]);

describe('the help articles', () => {
  it('are twelve, in the index’s order, each titled as its question', () => {
    const all = helpArticles();
    expect(all.map((a) => a.slug)).toEqual(HELP_SLUGS);
    expect(all).toHaveLength(12);
    for (const a of all) expect(a.question).toBe(HELP_QUESTIONS[a.slug]);
    expect(new Set(all.map((a) => a.description)).size).toBe(12);
  });

  it('the index links each question to its page, in order', () => {
    const html = renderToStaticMarkup(<HelpIndexScreen data={helpIndexView()} />);
    const linked = [...html.matchAll(/<a href="(\/help\/[^"]+)">([^<]*)<\/a>/g)].map((m) => [
      m[1],
      m[2]!.replace(/&#x27;/g, "'"),
    ]);
    expect(linked).toEqual(HELP_SLUGS.map((s) => [helpPath(s), HELP_QUESTIONS[s]]));
  });
});

describe('the numbers on the help pages', () => {
  it.each(PATHS)('%s: each one is a price, a limit or a named figure', (path) => {
    const found = numbersIn(textOf(render(path)));
    expect(found.filter((n) => !ALLOWED.has(n))).toEqual([]);
  });

  it('the pages render numbers (anti-vacuity), the plans’ prices among them', () => {
    const all = pages().flatMap(([, html]) => numbersIn(textOf(html)));
    expect(all.length).toBeGreaterThan(40);
    const plans = textOf(render(helpPath('plans')));
    for (const price of [PRICES.PRO_MONTHLY, PRICES.PRO_YEARLY, PRICES.AGENCY_MONTHLY])
      expect(plans).toContain(PRICES.usd(price));
  });

  it('the reader takes digits with separators as one number', () => {
    expect(numbersIn('up to 2,000 pages, $19, 1,234,567')).toEqual([2000, 19, 1234567]);
    expect(numbersIn(textOf(`<p>${CRAWL_USER_AGENT} 7</p>`))).toEqual([7]);
  });
});

/** The help pages' text: the index and each article, in order. */
async function allText(): Promise<string> {
  const view = await import('@/lib/v2/help/view');
  const screens = await import('@/components/v2/screens/help/HelpScreens');
  const { HELP_SLUGS: slugs } = await import('@/lib/v2/help/questions');
  return [
    renderToStaticMarkup(<screens.HelpIndexScreen data={view.helpIndexView()} />),
    ...slugs.map((s) =>
      renderToStaticMarkup(<screens.HelpArticleScreen data={view.helpArticleView(s)} />),
    ),
  ]
    .map(textOf)
    .join('\n');
}

/** `n` is on the page as a numeral, or as its word when it has one. */
const shows = (text: string, n: number) =>
  new Set(numbersIn(text)).has(n) ||
  (numberWord(n) !== count(n) && new RegExp(`\\b${numberWord(n)}\\b`, 'i').test(text));

// The build below gives each module that owns a figure on the pages another value, one the pages
// do not show today (`PAIRS`), and then checks:
// - each altered value is on the pages, as a numeral or as the word the page spells it with, as
//   many times as `READS` states for its owner (the places the articles read it);
// - no value of today's is left as a numeral, but for the grade weights' (`STAYS`), nor as a word,
//   but for "one" and "two", which are on the pages as many times as `PROSE_USES` states.
// A figure typed, in any form, where an article reads an owner leaves that owner's count in `READS`
// one short. A figure typed in a new place keeps today's value: as a numeral it is left over unless
// it equals a grade weight (Pro's and Agency's 10 re-checks do), as "one" or "two" it changes a
// count in `PROSE_USES`, and as another word it is left over.
// Owners altered: prices.ts; each GATES number the pages show; TRIAL_DAYS; the sign-in constants;
// MAGIC_LINK_PER_EMAIL_PER_HOUR; ANONYMOUS_EXPIRY_HOURS; CANCEL_CLICKS; MIN_GRADEABLE_PAGES; the
// re-check window (pinned.ts); the restore window (copy/restore-window.ts, which the deletion pages'
// sentences print as a numeral and as a word). One module's sentences are quoted whole, and are
// built when it loads, so the build rewrites their figure as that module would print it: the
// crawlers AI_WAITING names ("two"). Not altered: the grade weights and the number of their parts,
// which pinned.test.ts holds to the engine.
describe('the figures follow the modules that own them, not the values typed today', () => {
  const TODAY_RESTORE = RESTORE_DAYS;
  /**
   * The re-check sentence names Pro and Agency together when their re-checks are equal. The altered
   * build keeps them equal when today's are, so it renders the branch today's pages render, and
   * counts them as one owner (Pro's) in `PAIRS`.
   */
  const PAID_SAME = GATES.pro.manualChecksPerSiteDay === GATES.agency.manualChecksPerSiteDay;
  const ALTERED = {
    gates: {
      free: { sites: 6, fixesVisible: 8, pagesPerCheck: 450, manualChecksPerSiteDay: 43 },
      pro: {
        sites: 11,
        seats: 12,
        competitorsPerSite: 22,
        pagesPerCheck: 2300,
        manualChecksPerSiteDay: 27,
      },
      agency: {
        sites: 37,
        seats: 31,
        competitorsPerSite: 29,
        pagesPerCheck: 2700,
        manualChecksPerSiteDay: PAID_SAME ? 27 : 23,
      },
    },
    prices: { PRO_MONTHLY: 21, PRO_YEARLY: 210, AGENCY_MONTHLY: 123, AGENCY_YEARLY: 1230 },
    trialDays: 26,
    auth: { AUTH_LINK_MINUTES: 45, RESEND_HINT_MINUTES: 33, TRIAL_REMINDER_DAYS_BEFORE_END: 9 },
    magicLinkPerHour: 41,
    anonymousHours: 36,
    cancelClicks: 13,
    minGradeablePages: 18,
    recheckWindowHours: 28,
    restoreDays: 16,
    scoredCrawlers: 17,
  };

  /** Today's value of each owner the build alters, beside its altered value. */
  const PAIRS: [string, number, number][] = [
    ...(['free', 'pro', 'agency'] as const).flatMap((tier) =>
      Object.entries(ALTERED.gates[tier])
        .filter(([k]) => !(PAID_SAME && tier === 'agency' && k === 'manualChecksPerSiteDay'))
        .map(([k, v]): [string, number, number] => [
          `GATES.${tier}.${k}`,
          GATES[tier][k as keyof (typeof ALTERED.gates)[typeof tier]] as number,
          v,
        ]),
    ),
    ...Object.entries(ALTERED.prices).map(([k, v]): [string, number, number] => [
      k,
      PRICES[k as keyof typeof ALTERED.prices],
      v,
    ]),
    ['TRIAL_DAYS', TRIAL_DAYS, ALTERED.trialDays],
    ['AUTH_LINK_MINUTES', AUTH_LINK_MINUTES, ALTERED.auth.AUTH_LINK_MINUTES],
    ['RESEND_HINT_MINUTES', RESEND_HINT_MINUTES, ALTERED.auth.RESEND_HINT_MINUTES],
    [
      'TRIAL_REMINDER_DAYS_BEFORE_END',
      TRIAL_REMINDER_DAYS_BEFORE_END,
      ALTERED.auth.TRIAL_REMINDER_DAYS_BEFORE_END,
    ],
    ['MAGIC_LINK_PER_EMAIL_PER_HOUR', MAGIC_LINK_PER_EMAIL_PER_HOUR, ALTERED.magicLinkPerHour],
    ['ANONYMOUS_EXPIRY_HOURS', ANONYMOUS_EXPIRY_HOURS, ALTERED.anonymousHours],
    ['CANCEL_CLICKS', CANCEL_CLICKS, ALTERED.cancelClicks],
    ['MIN_GRADEABLE_PAGES', MIN_GRADEABLE_PAGES, ALTERED.minGradeablePages],
    ['RECHECK_WINDOW_HOURS', RECHECK_WINDOW_HOURS, ALTERED.recheckWindowHours],
    ['the restore window (copy/restore-window.ts)', TODAY_RESTORE, ALTERED.restoreDays],
    ['the scored crawlers AI_WAITING names', 2, ALTERED.scoredCrawlers],
  ];

  /**
   * Words of today's values the pages also use for other things ("for one email", "two grades"),
   * with the number of times the altered pages show each. A figure typed as one of these words
   * adds one.
   */
  const PROSE_USES: Record<string, number> = { one: 13, two: 5 };
  /**
   * How many times the altered pages show each owner's altered value, as a numeral or as its word:
   * the number of places the pages read that owner. A figure typed in one of those places shows
   * today's value there, so its owner's altered value is one short.
   */
  const READS: Record<string, number> = {
    'GATES.free.sites': 1,
    'GATES.free.fixesVisible': 4,
    'GATES.free.pagesPerCheck': 1,
    'GATES.free.manualChecksPerSiteDay': 2,
    'GATES.pro.sites': 1,
    'GATES.pro.seats': 1,
    'GATES.pro.competitorsPerSite': 1,
    'GATES.pro.pagesPerCheck': 1,
    'GATES.pro.manualChecksPerSiteDay': 3,
    'GATES.agency.sites': 1,
    'GATES.agency.seats': 1,
    'GATES.agency.competitorsPerSite': 1,
    'GATES.agency.pagesPerCheck': 1,
    PRO_MONTHLY: 1,
    PRO_YEARLY: 1,
    AGENCY_MONTHLY: 1,
    AGENCY_YEARLY: 1,
    TRIAL_DAYS: 4,
    AUTH_LINK_MINUTES: 1,
    RESEND_HINT_MINUTES: 1,
    TRIAL_REMINDER_DAYS_BEFORE_END: 1,
    MAGIC_LINK_PER_EMAIL_PER_HOUR: 1,
    ANONYMOUS_EXPIRY_HOURS: 1,
    CANCEL_CLICKS: 1,
    MIN_GRADEABLE_PAGES: 1,
    RECHECK_WINDOW_HOURS: 4,
    'the restore window (copy/restore-window.ts)': 3,
    'the scored crawlers AI_WAITING names': 1,
  };
  const wordTimes = (text: string, word: string) =>
    (text.match(new RegExp(`\\b${word}\\b`, 'gi')) ?? []).length;
  const timesShown = (text: string, n: number) =>
    numbersIn(text).filter((x) => x === n).length +
    (numberWord(n) === count(n) ? 0 : wordTimes(text, numberWord(n)));
  /** Numerals that stay: the grade weights, which the build does not alter. */
  const STAYS = new Set<number>([...numeric(AI_WEIGHTS), ...numeric(SEO_WEIGHTS)]);

  async function alteredText(): Promise<string> {
    vi.resetModules();
    vi.doMock('@/lib/entitlement-v2', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/entitlement-v2')>();
      return {
        ...real,
        GATES: {
          free: { ...real.GATES.free, ...ALTERED.gates.free },
          pro: { ...real.GATES.pro, ...ALTERED.gates.pro },
          agency: { ...real.GATES.agency, ...ALTERED.gates.agency },
        },
      };
    });
    vi.doMock('@/lib/billing/prices', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/billing/prices')>()),
      ...ALTERED.prices,
    }));
    vi.doMock('@/lib/billing/state-machine', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/billing/state-machine')>()),
      TRIAL_DAYS: ALTERED.trialDays,
    }));
    vi.doMock('@/lib/auth/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/auth/constants')>()),
      ...ALTERED.auth,
    }));
    vi.doMock('@/lib/limits', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/limits')>()),
      MAGIC_LINK_PER_EMAIL_PER_HOUR: ALTERED.magicLinkPerHour,
    }));
    vi.doMock('@/lib/v2/pipeline/limits', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/v2/pipeline/limits')>()),
      ANONYMOUS_EXPIRY_HOURS: ALTERED.anonymousHours,
    }));
    vi.doMock('@/lib/v2/copy/settings', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/v2/copy/settings')>()),
      CANCEL_CLICKS: ALTERED.cancelClicks,
    }));
    vi.doMock('@crawlmouse/types', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@crawlmouse/types')>()),
      MIN_GRADEABLE_PAGES: ALTERED.minGradeablePages,
    }));
    vi.doMock('@/lib/v2/help/pinned', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/v2/help/pinned')>()),
      RECHECK_WINDOW_HOURS: ALTERED.recheckWindowHours,
    }));
    vi.doMock('@/lib/v2/copy/restore-window', () => ({ RESTORE_DAYS: ALTERED.restoreDays }));
    vi.doMock('@/lib/v2/view/effect-headline', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/v2/view/effect-headline')>();
      return {
        ...real,
        AI_WAITING: Object.fromEntries(
          Object.entries(real.AI_WAITING).map(([k, t]) => [
            k,
            t.replace(
              /\btwo scored crawlers\b/,
              `${numberWord(ALTERED.scoredCrawlers)} scored crawlers`,
            ),
          ]),
        ),
      };
    });
    const mocked = [
      '@/lib/entitlement-v2',
      '@/lib/billing/prices',
      '@/lib/billing/state-machine',
      '@/lib/auth/constants',
      '@/lib/limits',
      '@/lib/v2/pipeline/limits',
      '@/lib/v2/copy/settings',
      '@crawlmouse/types',
      '@/lib/v2/help/pinned',
      '@/lib/v2/copy/restore-window',
      '@/lib/v2/view/effect-headline',
    ];
    try {
      return await allText();
    } finally {
      for (const m of mocked) vi.doUnmock(m);
      vi.resetModules();
    }
  }

  it('no altered value is on today’s pages, so finding one later proves it was read', async () => {
    const today = await allText();
    expect(PAIRS.filter(([, , altered]) => shows(today, altered))).toEqual([]);
    expect(new Set(PAIRS.map(([, , altered]) => altered)).size).toBe(PAIRS.length);
    expect(PAIRS.filter(([, now]) => PAIRS.some(([, , altered]) => altered === now))).toEqual([]);
  });

  it('each altered value is on the altered pages', async () => {
    const text = await alteredText();
    const missing = PAIRS.filter(([, , altered]) => !shows(text, altered)).map(([name]) => name);
    expect(missing).toEqual([]);
    expect(text).toContain(`${count(ALTERED.restoreDays)} days`);
    expect(text).toMatch(new RegExp(`\\b${numberWord(ALTERED.restoreDays)} days\\b`));
  });

  it('no value of today’s is left on the altered pages', async () => {
    const text = await alteredText();
    const numerals = new Set(numbersIn(text));
    const left = PAIRS.filter(([, now]) => {
      if (!STAYS.has(now) && numerals.has(now)) return true;
      const word = numberWord(now);
      return word !== count(now) && !Object.hasOwn(PROSE_USES, word) && wordTimes(text, word) > 0;
    }).map(([name, now]) => `${name} (${now})`);
    expect(left).toEqual([]);
    const prose = Object.fromEntries(Object.keys(PROSE_USES).map((w) => [w, wordTimes(text, w)]));
    expect(prose).toEqual(PROSE_USES);
  });

  it('each owner’s altered value is on the altered pages as many times as the pages read it', async () => {
    const text = await alteredText();
    expect(Object.keys(READS).sort()).toEqual(PAIRS.map(([name]) => name).sort());
    const shown = Object.fromEntries(
      PAIRS.map(([name, , altered]) => [name, timesShown(text, altered)]),
    );
    expect(shown).toEqual(READS);
  });
});

/** An article's plan section: the capability keys of the list under `heading`. */
function planKeys(articles: { slug: string; blocks: HelpBlock[] }[], heading: string): string[][] {
  const blocks = articles.find((a) => a.slug === 'plans')!.blocks;
  const at = blocks.findIndex((b) => b.kind === 'heading' && b.text === heading);
  const list = blocks.slice(at + 1).find((b) => b.kind === 'list');
  if (list?.kind !== 'list') throw new Error(`no list under ${heading}`);
  return list.items.map((i) => [...i.capabilities]);
}

/** The feature lines a tier's gates call for, beyond the four every plan has, by their keys. */
function expectedFeatures(g: TierGates): string[][] {
  return [
    ...(g.slack ? [['change_emails', 'slack_alerts']] : []),
    ...(g.seats > 1 ? [['seats']] : []),
    ...(g.competitorsPerSite > 0 ? [['competitors']] : []),
    ...(g.exports ? [['exports']] : []),
    ...(g.agencyBranding ? [['client_reports', 'client_report_page']] : []),
  ];
}

describe('each plan’s feature lines follow its GATES', () => {
  const HEADINGS = { free: 'Free', pro: 'Pro', agency: 'Agency' } as const;
  // The switches set so that no two of them agree on all three tiers (Pro is today's: each switch
  // on but agencyBranding), so a line keyed on the wrong switch shows on a tier it should not.
  const SET = {
    free: { slack: true, seats: 1, competitorsPerSite: 2, exports: false, agencyBranding: true },
    agency: { slack: true, seats: 5, competitorsPerSite: 0, exports: false, agencyBranding: false },
  };
  const check = (
    articles: { slug: string; blocks: HelpBlock[] }[],
    gates: Record<Tier, TierGates>,
  ) => {
    for (const tier of ['free', 'pro', 'agency'] as const) {
      const keys = planKeys(articles, HEADINGS[tier]);
      expect(keys.slice(4), tier).toEqual(expectedFeatures(gates[tier]));
      expect(keys).toHaveLength(4 + expectedFeatures(gates[tier]).length);
    }
  };

  it('today’s GATES', () => {
    check(helpArticles(), GATES);
    expect(expectedFeatures(GATES.free)).toEqual([]);
    expect(expectedFeatures(GATES.agency).length).toBeGreaterThan(3);
  });

  it('GATES with the switches set apart', async () => {
    vi.resetModules();
    vi.doMock('@/lib/entitlement-v2', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/entitlement-v2')>();
      return {
        ...real,
        GATES: {
          free: { ...real.GATES.free, ...SET.free },
          pro: real.GATES.pro,
          agency: { ...real.GATES.agency, ...SET.agency },
        },
      };
    });
    try {
      const { helpArticles: altered } = await import('@/lib/v2/help/articles');
      const { GATES: set } = await import('@/lib/entitlement-v2');
      const switches = (
        ['slack', 'seats', 'competitorsPerSite', 'exports', 'agencyBranding'] as const
      ).map((k) =>
        (['free', 'pro', 'agency'] as const)
          .map((t) => (k === 'seats' ? set[t].seats > 1 : Boolean(set[t][k])))
          .join(),
      );
      expect(new Set(switches).size).toBe(switches.length);
      check(altered(), set);
    } finally {
      vi.doUnmock('@/lib/entitlement-v2');
      vi.resetModules();
    }
  });
});

/** An article's text, its sentences joined. */
function articleText(slug: string): string {
  const a = helpArticles().find((x) => x.slug === slug)!;
  return a.blocks
    .flatMap((b) => (b.kind === 'paragraph' ? b.sentences : b.kind === 'list' ? b.items : []))
    .map((x) => x.text)
    .join(' ');
}

describe('the delete article’s money sentences (deletionMoney)', () => {
  // Every state Stripe gives a subscription; the Record makes the compiler hold the list complete.
  const STATUSES: Record<SubscriptionStatus, true> = {
    trialing: true,
    active: true,
    past_due: true,
    canceled: true,
    unpaid: true,
    incomplete: true,
    incomplete_expired: true,
    paused: true,
  };

  it('say what deletionMoney says for each state the code tells apart', () => {
    const text = articleText('delete-account');
    const said = new Set(Object.keys(STATUSES).flatMap((status) => deletionMoney(status) ?? []));
    expect(said.size).toBeGreaterThan(2);
    for (const sentence of said) expect(text).toContain(sentence);
    expect(text).toContain(DELETE_COPY.moneyNotCollected);
  });
});

describe('the Pro trial, where an article promises it', () => {
  it('is said to be offered once, by the trial record', () => {
    const paragraphs = helpArticles().flatMap((a) =>
      a.blocks.flatMap((b) =>
        b.kind === 'paragraph' ? [b.sentences.map((x) => x.text).join(' ')] : [],
      ),
    );
    const promising = paragraphs.filter(
      (p) => p.includes(`${TRIAL_DAYS} days of Pro`) || p.startsWith('Pro’s trial'),
    );
    expect(promising).toHaveLength(2);
    for (const p of promising) expect(p).toMatch(/offered once/);
  });
});

describe('the re-check limit', () => {
  it('is counted over the cap’s window, which no page calls a day', () => {
    const texts = [articleText('fix-still-open'), articleText('plans')];
    for (const t of texts) {
      expect(t).toContain(`${RECHECK_WINDOW_HOURS} hours`);
      expect(t).not.toMatch(/\b(a|the) day\b|day’s re-checks/);
    }
  });
});

describe('the capabilities the help pages name', () => {
  it.each(PATHS)('%s: tagged, a coming one marked, none loose', (path) => {
    const sweep = capabilitySweep(render(path));
    expect(sweep.unknown).toEqual([]);
    expect(sweep.unmarked).toEqual([]);
    expect(sweep.overMarked).toEqual([]);
    expect(sweep.loose).toEqual([]);
  });

  it('the sweep sees coming capabilities named, and the plans mark them (anti-vacuity)', () => {
    const seen = pages().reduce((n, [, html]) => n + capabilitySweep(html).seen, 0);
    expect(seen).toBeGreaterThan(3);
    const plans = render(helpPath('plans'));
    expect(plans.match(/data-v2-coming=""/g)!.length).toBeGreaterThan(2);
  });

  it('no title or description names a coming capability, since a search result shows no mark', () => {
    const shown = [
      HELP_COPY.title,
      HELP_COPY.description,
      ...helpArticles().flatMap((a) => [a.question, a.description]),
    ];
    expect(shown.flatMap(comingNamedIn)).toEqual([]);
  });
});

/** Next's notFound() throws an error whose digest names the 404 fallback. */
async function digestOf(render: () => unknown): Promise<string> {
  try {
    await render();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return 'rendered';
}

describe('/help and /help/[slug] (D4)', () => {
  const index = () => import('../../app/help/page');
  const article = () => import('../../app/help/[slug]/page');
  const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

  it('builds the twelve articles and no other segment', async () => {
    const route = await article();
    expect(route.dynamicParams).toBe(false);
    expect(route.generateStaticParams()).toEqual(HELP_SLUGS.map((slug) => ({ slug })));
  });

  it('the index is a 404 with V2_CHECKS_PUBLIC unset', async () => {
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const { default: Page } = await index();
    expect(await digestOf(() => Page())).toContain('404');
  });

  it.each(HELP_SLUGS)('/help/%s is a 404 with V2_CHECKS_PUBLIC unset', async (slug) => {
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const { default: Page } = await article();
    expect(await digestOf(() => Page(params(slug)))).toContain('404');
  });

  it('answers 404 for a slug it does not have, with the flag on', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const { default: Page } = await article();
    expect(await digestOf(() => Page(params('help')))).toContain('404');
    expect(await digestOf(() => Page(params('__proto__')))).toContain('404');
  });

  /** One h1 holding `h1`, the page's own canonical, no robots of its own and no FAQPage markup. */
  function expectPage(
    markup: string,
    meta: { alternates?: unknown; title?: unknown; description?: unknown; robots?: unknown },
    own: { path: string; title: string; description: string },
  ) {
    expect(meta.alternates).toEqual({ canonical: own.path });
    expect(meta.title).toBe(own.title);
    expect(meta.description).toBe(own.description);
    expect(meta.robots).toBeUndefined();
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]?.replace(/&#x27;/g, "'")).toBe(own.title);
    expect(markup).not.toMatch(/FAQPage|application\/ld\+json/);
    expect(markup).not.toContain('href="#"');
    expect(markup.match(/data-v2-primary=""/g)).toBeNull();
  }

  it('with V2_CHECKS_PUBLIC on, the index is the page: its own title, canonical and h1', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const { default: Page, metadata } = await index();
    const markup = renderToStaticMarkup(Page() as ReactElement);
    expectPage(markup, metadata, {
      path: '/help',
      title: HELP_COPY.title,
      description: HELP_COPY.description,
    });
  });

  it.each(HELP_SLUGS)(
    '/help/%s with V2_CHECKS_PUBLIC on opens with its question, with its own title and canonical',
    async (slug) => {
      vi.stubEnv('V2_CHECKS_PUBLIC', '1');
      const { default: Page, generateMetadata } = await article();
      const meta = await generateMetadata(params(slug));
      const markup = renderToStaticMarkup((await Page(params(slug))) as ReactElement);
      const a = helpArticles().find((x) => x.slug === slug)!;
      expectPage(markup, meta, {
        path: helpPath(slug),
        title: a.question,
        description: a.description,
      });
    },
  );

  it('links the help centre from the footer once the flag is on', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const { default: Page } = await index();
    expect(renderToStaticMarkup(Page() as ReactElement)).toContain('href="/help">Help</a>');
  });
});
