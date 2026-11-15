/**
 * Every price a customer is shown is the one `lib/billing/prices.ts` holds (CC-39 ruling 4). Agency
 * read $69 on Home and on the Result's Pro panel after the decision of 2026-11-03 had set it at $99;
 * a customer told one price and charged another is the failure this file stops.
 *
 * Three checks:
 * 1. The source names no price as a typed number: a `$`+digits that is a whole quoted string, or is
 *    followed by "a month", "a year", "a seat", "a site", "/mo", "/month", "/yr" or "/year".
 * 2. Every `$`+digits in a copy module's strings, and in every registry entry's `rendered`, is a
 *    price `SHOWN_PRICES` holds.
 * 3. Every `$`+digits on a rendered v2 screen is a price `SHOWN_PRICES` holds.
 *
 * What is not checked, by name: a registry entry's `locked` text (the artboard as drawn, kept so the
 * lock comparison can apply the entry), comments, `lib/blog/**` (other products' prices, quoted in
 * articles), test and test-support files, `lib/billing/prices.ts` itself, and the files in
 * `PINNED_V1` below.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PricingScreen } from '../../components/v2/screens/pricing/PricingScreen';
import {
  pricingSignedIn,
  pricingSignedOut,
} from '../../app/(v2-preview)/v2-preview/_preview/pricing';
import { AGENCY_MONTHLY, EXTRA_SEAT, PRO_MONTHLY, usd } from '../../lib/billing/prices';
import { COPY_CHANGES } from '../../lib/v2/copy-registry';
import { formatPlanPrice, SHOWN_PRICES } from '../../lib/v2/copy/plan-price';
import { WEB_ROOT } from './_lib/tokens-css';
import {
  ACCOUNT_ELEMENTS,
  CC27_ELEMENTS,
  CC31_ELEMENTS,
  RESULT_NAMES,
  homeElement,
  resultElement,
} from './_lib/screens';

const DOLLARS = /\$\d+(?!\d)/g;
/** A `$`+digits that names a price: a whole quoted string, or followed by what it is the price of. */
const TYPED_PRICE =
  /(['"`])\$\d+\1|\$\d+(?=\s*(?:a month|a year|a seat|a site|\/mo\b|\/month|\/yr\b|\/year))/g;

/**
 * `$`+digits a shown string may hold that are not our prices, each with why. The content segment's
 * evidence quotes a crawled product page as a crawler reads it, prices and all.
 */
const NOT_OUR_PRICES: Readonly<Record<string, string>> = {
  $329: 'a crawled product page quoted as evidence (lib/v2/copy/segment-content.ts)',
  $100: 'the Terms’ liability cap, "USD $100" (app/terms/page.tsx), not a plan’s price',
};

const unknownPrices = (text: string) =>
  [...text.matchAll(DOLLARS)]
    .map(([d]) => d)
    .filter((d) => !SHOWN_PRICES.has(d) && !Object.hasOwn(NOT_OUR_PRICES, d));

/**
 * v1 files left as they are, each with why. They type Pro's prices, which prices.ts also holds
 * (checked below), so none of them shows a price prices.ts does not.
 */
const PINNED_V1: Readonly<Record<string, string>> = {
  'app/pricing/page.tsx':
    '__tests__/v2/public-pages.test.tsx ("app/pricing/page.tsx is the file main has", CC-29 D1); /pricing is served by the v2 page while V2_BILLING is on',
  'components/billing/PricingCards.tsx':
    'rendered only by the v1 /pricing page above; the file was never formatted, so any edit reflows all of it under the CI Prettier check',
  'app/terms/page.tsx':
    'the legal Terms: never formatted, so an edit reflows the whole page, and a JSX reflow can change the legal text’s whitespace (CC-39 ruling 4, Q9)',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return ['node_modules', '__tests__', 'test-support', 'blog'].includes(name)
        ? []
        : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

/** A line's text with its comment, if the whole line is one, left out. */
const code = (line: string) => (/^\s*(\/\/|\/?\*)/.test(line) ? '' : line);

/**
 * Every string held in an exported value of a module, functions aside, and leaving out a registry
 * entry's `locked` text: the artboard as drawn, which no screen renders.
 */
function strings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Object.entries(value).flatMap(([key, v]) => (key === 'locked' ? [] : strings(v, seen)));
}

const text = (el: ReactElement) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&quot;|&amp;/g, ' ');

describe('a shown price is the one prices.ts holds (CC-39 ruling 4)', () => {
  it('formats each plan and extra from prices.ts', () => {
    expect(formatPlanPrice('agency')).toBe(usd(AGENCY_MONTHLY));
    expect(SHOWN_PRICES.has(usd(AGENCY_MONTHLY))).toBe(true);
    expect(SHOWN_PRICES.has(usd(EXTRA_SEAT))).toBe(true);
    // The two prices the screens showed before this step are not among them.
    expect(SHOWN_PRICES.has('$69')).toBe(false);
    expect(SHOWN_PRICES.has('$9')).toBe(false);
  });

  it('no source file outside the exemptions types a price', () => {
    const offenders: string[] = [];
    for (const root of ['app', 'components', 'lib']) {
      for (const file of sourceFiles(join(WEB_ROOT, root))) {
        const rel = relative(WEB_ROOT, file);
        if (rel === join('lib', 'billing', 'prices.ts')) continue;
        if (Object.hasOwn(PINNED_V1, rel)) {
          // Not read from prices.ts, but every price it types is one of them.
          expect(unknownPrices(readFileSync(file, 'utf8')), rel).toEqual([]);
          continue;
        }
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/^\s*locked:/.test(line)) return;
            for (const [m] of code(line).matchAll(TYPED_PRICE))
              offenders.push(`${rel}:${i + 1} ${m}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every copy module’s strings name only prices.ts’s prices', () => {
    const dir = join(WEB_ROOT, 'lib', 'v2', 'copy');
    const modules = readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
    expect(modules.length).toBeGreaterThan(20);
    const found: string[] = [];
    return Promise.all(
      modules.map(async (f) => {
        const mod = (await import(join(dir, f))) as Record<string, unknown>;
        for (const [name, value] of Object.entries(mod))
          for (const s of strings(value))
            for (const d of unknownPrices(s)) found.push(`${f} ${name}: ${d}`);
      }),
    ).then(() => expect(found).toEqual([]));
  });

  it('every registry entry renders only prices.ts’s prices (its locked text is the artboard)', () => {
    const found = COPY_CHANGES.flatMap((c) =>
      unknownPrices(c.rendered).map((d) => `${c.screen} ${JSON.stringify(c.locked)}: ${d}`),
    );
    expect(found).toEqual([]);
    // Home's and the Result's entries move the artboard's $69 to the decided price. (Others with a
    // $69 in their locked text render it elsewhere, or render nothing where the line is left out.)
    for (const screen of ['home', 'result'] as const) {
      const entry = COPY_CHANGES.find((c) => c.screen === screen && c.locked.includes('$69'));
      expect(entry?.rendered, screen).toContain(usd(AGENCY_MONTHLY));
    }
  });

  it('every rendered v2 screen names only prices.ts’s prices', () => {
    const elements: Record<string, () => ReactElement> = {
      home: homeElement,
      ...Object.fromEntries(RESULT_NAMES.map((n) => [`result:${n}`, () => resultElement(n)])),
      'pricing:signed-out': () => <PricingScreen view={pricingSignedOut()} />,
      'pricing:signed-in': () => <PricingScreen view={pricingSignedIn()} />,
      ...ACCOUNT_ELEMENTS,
      ...CC27_ELEMENTS,
      ...CC31_ELEMENTS,
    };
    const rendered = Object.entries(elements).map(([name, el]) => [name, text(el())] as const);
    const found = rendered.flatMap(([name, t]) => unknownPrices(t).map((d) => `${name}: ${d}`));
    expect(found).toEqual([]);
    // The sweep read prices: the screens it rendered show Pro's and Agency's.
    const seen = new Set(rendered.flatMap(([, t]) => [...t.matchAll(DOLLARS)].map(([d]) => d)));
    expect([...seen]).toEqual(expect.arrayContaining([usd(PRO_MONTHLY), usd(AGENCY_MONTHLY)]));
  });

  it('Home’s Agency card and the Result’s Pro panel show the decided Agency price', () => {
    const agency = `${usd(AGENCY_MONTHLY)} a month`;
    expect(text(homeElement())).toMatch(
      new RegExp(`Agency\\s+\\${usd(AGENCY_MONTHLY)}\\s+a month`),
    );
    expect(text(resultElement('bad-site')).replace(/\s+/g, ' ')).toContain(
      `your own brand, ${agency}.`,
    );
  });
});
