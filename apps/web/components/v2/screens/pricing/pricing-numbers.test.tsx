/**
 * Every number the Pricing page renders is one the code that owns it holds (CC-29 D2): a price in
 * `prices.ts`, a limit in `GATES`, the trial's length, the Agency Plus row's constant (owner ruling
 * Q7), or one entry of the short, named list below. A price typed into the copy fails here.
 *
 * The page is rendered whole, shell and footer included, for each viewer state and both intervals,
 * and every run of digits in its text is read (thousands separators joined: "2,000" is 2000).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TRIAL_DAYS, FREE_START } from '@/lib/billing/state-machine';
import * as PRICES from '@/lib/billing/prices';
import { GATES } from '@/lib/entitlement-v2';
import { AGENCY_PLUS, ANNUAL_RENEWAL_REMINDER_DAYS, FREE_PRICE } from '@/lib/v2/copy/pricing';
import { EVIDENCE_CONDENSED_AFTER_DAYS } from '@/lib/v2/copy/settings';
import { pricingView, type PricingViewer } from '@/lib/v2/view/pricing';
import { PricingScreen } from './PricingScreen';

/** Numbers on the page that are not a price or a limit, each with what it is. */
const NOT_PRICES: Record<string, number> = {
  'Free costs nothing': FREE_PRICE,
  'the Agency trial is charged on the day after it ends': TRIAL_DAYS + 1,
  'the first Agency site sold beyond the plan': GATES.agency.sites + 1,
  'evidence is condensed after this many days (FACTS A6)': EVIDENCE_CONDENSED_AFTER_DAYS,
  'the first annual renewal reminder (FACTS L6)': ANNUAL_RENEWAL_REMINDER_DAYS[0],
  'the second annual renewal reminder (FACTS L6)': ANNUAL_RENEWAL_REMINDER_DAYS[1],
  'the footer’s copyright year (SiteFooter, the year the page renders)': new Date().getFullYear(),
};

function numbersIn(record: object): number[] {
  return Object.values(record).filter((v): v is number => typeof v === 'number');
}

const ALLOWED = new Set<number>([
  ...numbersIn(PRICES),
  ...Object.values(GATES).flatMap(numbersIn),
  TRIAL_DAYS,
  ...numbersIn(AGENCY_PLUS),
  ...Object.values(NOT_PRICES),
]);

/** The visible text of a rendered page: tags, comments and attribute values removed. */
function textOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;|&#\d+;/g, ' ');
}

export function renderedNumbers(html: string): number[] {
  return [...textOf(html).matchAll(/\d{1,3}(?:,\d{3})+|\d+/g)].map((m) =>
    Number(m[0].replace(/,/g, '')),
  );
}

const NOW = new Date('2026-11-12T12:00:00Z');
const VIEWERS: [string, PricingViewer][] = [
  ['signed out', { kind: 'signed_out' }],
  [
    'free, trial open',
    {
      kind: 'signed_in',
      account: {
        id: 'a0000000-0000-4000-8000-00000000000a',
        owner: true,
        tier: 'free',
        snapshot: FREE_START,
        customer: null,
      },
      agency: { held: false, used: null },
    },
  ],
  [
    'free, both trials used',
    {
      kind: 'signed_in',
      account: {
        id: 'a0000000-0000-4000-8000-00000000000a',
        owner: true,
        tier: 'free',
        snapshot: { ...FREE_START, trialUsedAt: NOW },
        customer: null,
      },
      agency: {
        held: false,
        used: {
          account: {
            id: 'a0000000-0000-4000-8000-00000000000b',
            snapshot: { ...FREE_START, trialUsedAt: NOW },
            customer: null,
          },
        },
      },
    },
  ],
];

const pages = VIEWERS.flatMap(([name, viewer]) =>
  (['month', 'year'] as const).map(
    (interval) =>
      [
        `${name}, ${interval}`,
        renderToStaticMarkup(
          <PricingScreen
            view={pricingView(viewer, interval, NOW, { accountDoor: true, checksPublic: true })}
          />,
        ),
      ] as const,
  ),
);

describe('the numbers on the Pricing page', () => {
  it.each(pages)('%s: each one is a price, a limit, the trial or a named number', (_name, html) => {
    const numbers = renderedNumbers(html);
    expect(numbers.length, 'the page renders numbers (anti-vacuity)').toBeGreaterThan(20);
    expect(numbers.filter((n) => !ALLOWED.has(n))).toEqual([]);
  });

  it('the page shows the catalog’s prices, not the artboard’s', () => {
    const [, month] = pages.find(([n]) => n === 'signed out, month')!;
    const [, year] = pages.find(([n]) => n === 'signed out, year')!;
    const text = textOf(month);
    expect(text).toContain(`$${PRICES.AGENCY_MONTHLY}`);
    expect(text).toContain(`$${PRICES.EXTRA_SEAT} a seat`);
    expect(text).not.toContain('$69');
    expect(text).not.toContain('$9 a seat');
    expect(textOf(year)).toContain(`$${PRICES.AGENCY_YEARLY}`);
  });

  it('the reader reads digits with separators as one number', () => {
    expect(renderedNumbers('<p>up to 2,000 pages, $19 a month, 1,234,567</p>')).toEqual([
      2000, 19, 1234567,
    ]);
    expect(renderedNumbers('<p data-x="777">a <b>5</b> b</p><!-- 31 -->')).toEqual([5]);
  });
});
