/**
 * The help centre (CC-33 D4). Each page is rendered whole, shell and footer included:
 * - every run of digits it shows is a price, a limit or a figure the code that owns it holds, and
 *   built again against altered prices and GATES, the pages lose today's values (a typed figure
 *   stays, and fails);
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
import { GATES } from '../../lib/entitlement-v2';
import { MAGIC_LINK_PER_EMAIL_PER_HOUR } from '../../lib/limits';
import { DELETE_COPY, deletionMoney, RESTORE_DAYS } from '../../lib/v2/copy/deletion';
import { CANCEL_CLICKS } from '../../lib/v2/copy/settings';
import { helpArticles } from '../../lib/v2/help/articles';
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
import { numberWord } from '../../lib/v2/words';
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

// Built against prices and GATES no copy could contain, the pages must lose today's values, as
// numerals and as words. A figure typed equal to today's would stay, and fail here.
describe('the figures follow GATES and prices.ts, not the values typed today', () => {
  const ALTERED = {
    free: { pagesPerCheck: 450, manualChecksPerSiteDay: 4 },
    pro: {
      sites: 11,
      seats: 4,
      competitorsPerSite: 6,
      pagesPerCheck: 2300,
      manualChecksPerSiteDay: 17,
    },
    agency: {
      sites: 37,
      seats: 13,
      competitorsPerSite: 7,
      pagesPerCheck: 2300,
      manualChecksPerSiteDay: 17,
    },
    prices: {
      PRO_MONTHLY: 23,
      PRO_YEARLY: 230,
      AGENCY_MONTHLY: 123,
      AGENCY_YEARLY: 1230,
    },
  };

  async function alteredText(): Promise<string> {
    vi.resetModules();
    vi.doMock('@/lib/entitlement-v2', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/entitlement-v2')>();
      return {
        ...real,
        GATES: {
          free: { ...real.GATES.free, ...ALTERED.free },
          pro: { ...real.GATES.pro, ...ALTERED.pro },
          agency: { ...real.GATES.agency, ...ALTERED.agency },
        },
      };
    });
    vi.doMock('@/lib/billing/prices', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/billing/prices')>()),
      ...ALTERED.prices,
    }));
    try {
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
    } finally {
      vi.doUnmock('@/lib/entitlement-v2');
      vi.doUnmock('@/lib/billing/prices');
      vi.resetModules();
    }
  }

  const altered = new Set<number>(Object.values(ALTERED).flatMap(numeric));
  /** Words the pages use for other figures, which stay whatever the prices and gates are. */
  const otherWords = new Set(
    [
      MIN_GRADEABLE_PAGES,
      TRIAL_REMINDER_DAYS_BEFORE_END,
      CANCEL_CLICKS,
      GATES.free.sites,
      GATES.free.fixesVisible as number,
    ].map(numberWord),
  );
  /** Figures the pages show that no alteration moves: today's value of one of them stays. */
  const stays = new Set<number>([
    TRIAL_DAYS,
    ...numeric(AI_WEIGHTS),
    ...numeric(SEO_WEIGHTS),
    ANONYMOUS_EXPIRY_HOURS,
    AUTH_LINK_MINUTES,
    MAGIC_LINK_PER_EMAIL_PER_HOUR,
    RESTORE_DAYS,
  ]);
  /** Today's values the alteration moves, but for one, two and the figures that stay. */
  const moved = [
    GATES.free.pagesPerCheck,
    GATES.free.manualChecksPerSiteDay,
    ...Object.keys(ALTERED.pro).map((k) => GATES.pro[k as keyof typeof ALTERED.pro]),
    ...Object.keys(ALTERED.agency).map((k) => GATES.agency[k as keyof typeof ALTERED.agency]),
    ...Object.keys(ALTERED.prices).map((k) => PRICES[k as keyof typeof ALTERED.prices]),
  ].filter((n): n is number => typeof n === 'number' && n > 2 && !altered.has(n) && !stays.has(n));

  it('the altered values in, today’s out', async () => {
    const text = await alteredText();
    expect(text).toContain(PRICES.usd(ALTERED.prices.AGENCY_YEARLY));
    expect(text).toContain(`${ALTERED.pro.sites} sites`);
    expect(text).toContain(`${ALTERED.agency.pagesPerCheck.toLocaleString('en-US')} pages`);
    expect(moved.length).toBeGreaterThan(8);
    expect(moved).toEqual(expect.arrayContaining([GATES.free.pagesPerCheck, PRICES.PRO_MONTHLY]));
    const numerals = new Set(numbersIn(text));
    const left = moved.filter(
      (n) =>
        numerals.has(n) ||
        (!otherWords.has(numberWord(n)) &&
          numberWord(n) !== String(n) &&
          new RegExp(`\\b${numberWord(n)}\\b`, 'i').test(text)),
    );
    expect(left).toEqual([]);
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
