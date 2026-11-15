/**
 * Every price a customer is shown is the one `lib/billing/prices.ts` holds (CC-39 ruling 4). Agency
 * read $69 on Home and on the Result's Pro panel after the decision of 2026-11-03 had set it at $99;
 * a customer told one price and charged another is the failure this file stops.
 *
 * What it checks:
 * 1. Source (app, components, lib; not tests): no `$`+amount, spaced or with cents included, that is a
 *    whole quoted string or is followed within 30 characters by month, year, seat, site, billed, /mo
 *    or /yr. A price written like that is typed, whatever its value.
 * 2. Copy modules (`lib/v2/copy/*`) and every registry entry's `rendered`: each `$`+amount is one
 *    `SHOWN_PRICES` holds.
 * 3. The rendered v2 screens listed below: the same, and where a plan is named with its price ("Pro
 *    $19 a month", "Agency · $99 a month"), that price is the plan's for that interval.
 * 4. The blog (`lib/blog`, not otherwise swept: it quotes other products' prices): where it gives
 *    Pro's price, that price is Pro's.
 *
 * Not checked, by name: a registry entry's `locked` text (the artboard as drawn, which the lock
 * comparison replaces with `rendered`), whole-line comments, test and test-support files,
 * `lib/billing/prices.ts` itself, and the amounts `NOT_OUR_PRICES` lists for the one file each is in.
 * The v1 files in `PINNED_V1` are not held to check 1; check 2's rule is applied to them instead.
 * Screens not rendered here: the dashboard at its site limit, whose Agency line is built with
 * `formatPlanPrice` (check 1 holds its source).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

/** A `$` and an amount: whole dollars, spaced or not, or with cents (which no price of ours has). */
const AMOUNT = String.raw`\$\s*\d+(?:[.,]\d+)?(?!\d)`;
const DOLLARS = new RegExp(AMOUNT, 'g');
/** A typed price: a whole quoted amount, or an amount followed by what it is the price of. */
const TYPED_PRICE = new RegExp(
  String.raw`(['"\`])${AMOUNT}\1|${AMOUNT}(?=[^'"\`\n]{0,30}?(?:month|year|seat|site|billed|\/mo\b|\/yr\b))`,
  'g',
);
/**
 * A plan named with its price: "Pro $19 a month", "Agency · $99 a month", "Pro at $19/month". The
 * plan is the last one named before the price, within 40 characters and with no `$` between.
 */
const PLAN = String.raw`\b(?:Free|Pro|Agency)\b`;
const PLAN_PRICE = new RegExp(
  String.raw`\b(Free|Pro|Agency)\b(?! Plus)((?:(?!${PLAN})[^$]){0,40}?)(${AMOUNT})\s*(?:a |\/|per )?(month|year|mo|yr)\b`,
  'g',
);

const norm = (amount: string) => amount.replace(/\s+/g, '');

/** Amounts that are not our prices, each in the one file it is in, with why. */
const NOT_OUR_PRICES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'lib/v2/copy/segment-content.ts': {
    $329: 'a crawled product page quoted as evidence, its own price',
  },
  'lib/v2/copy/segment-nojs.ts': {
    $329: 'the same crawled product page, its JSON-LD and body quoted as evidence',
  },
  'app/terms/page.tsx': { $100: 'the Terms’ liability cap, "USD $100"' },
};

const unknownPrices = (text: string, file = '') =>
  [...text.matchAll(DOLLARS)]
    .map(([d]) => norm(d))
    .filter((d) => !SHOWN_PRICES.has(d) && !Object.hasOwn(NOT_OUR_PRICES[file] ?? {}, d));

/** Where a plan is named with its price, the price that is not the plan's for that interval. */
const wrongPlanPrices = (text: string) =>
  [...text.matchAll(PLAN_PRICE)]
    .map(([whole, plan, , amount, per]) => {
      const interval = per === 'year' || per === 'yr' ? 'year' : 'month';
      const want = formatPlanPrice(plan!.toLowerCase() as 'free' | 'pro' | 'agency', interval);
      return norm(amount!) === want ? null : `${whole.trim()} (want ${want})`;
    })
    .filter((x) => x !== null);

/**
 * v1 files left as they are, each with why. Each types Pro's prices; check 2's rule holds them to
 * prices prices.ts holds.
 */
const PINNED_V1: Readonly<Record<string, string>> = {
  'app/pricing/page.tsx':
    '__tests__/v2/public-pages.test.tsx ("app/pricing/page.tsx is the file main has", CC-29 D1); /pricing is served by the v2 page while V2_BILLING is on',
  'components/billing/PricingCards.tsx':
    'rendered only by the v1 /pricing page above; the file was never formatted, so any edit reflows all of it under the CI Prettier check',
  'app/terms/page.tsx':
    'the legal Terms: never formatted, so an edit reflows the whole page, and a JSX reflow can change the legal text’s whitespace (CC-39 ruling 4, Q9)',
};

const BLOG = join('lib', 'blog');
const posix = (p: string) => p.split(sep).join('/');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return ['node_modules', '__tests__', 'test-support'].includes(name) ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$|test-support\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

/** A line's text, or nothing when the whole line is a comment. */
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
    .replace(/&#x27;|&quot;|&amp;/g, ' ')
    .replace(/\s+/g, ' ');

describe('a shown price is the one prices.ts holds (CC-39 ruling 4)', () => {
  it('formats each plan and extra from prices.ts', () => {
    expect(formatPlanPrice('agency')).toBe(usd(AGENCY_MONTHLY));
    expect(SHOWN_PRICES.has(usd(AGENCY_MONTHLY))).toBe(true);
    expect(SHOWN_PRICES.has(usd(EXTRA_SEAT))).toBe(true);
    // The two prices the screens showed before this step are not among them.
    expect(SHOWN_PRICES.has('$69')).toBe(false);
    expect(SHOWN_PRICES.has('$9')).toBe(false);
  });

  it('the patterns catch a typed price however it is written', () => {
    const typed = (line: string) => [...line.matchAll(TYPED_PRICE)].map(([m]) => m);
    for (const line of [
      `price: '$69',`,
      'Agency, $69 a month',
      '$99, billed monthly',
      '$99.00 a month',
      '$ 69 a month',
      'Pro $19/mo',
    ])
      expect(typed(line), line).not.toEqual([]);
    // A template that reads prices.ts is not typed.
    expect(typed('`Agency, ${formatPlanPrice("agency")} a month`')).toEqual([]);
    expect(unknownPrices('$99.00 a month')).toEqual(['$99.00']);
    expect(wrongPlanPrices(`Agency · ${usd(PRO_YEARLY_FOR_TEST)} a month`)).not.toEqual([]);
  });

  it('no source file outside the exemptions types a price', () => {
    const offenders: string[] = [];
    for (const root of ['app', 'components', 'lib']) {
      for (const file of sourceFiles(join(WEB_ROOT, root))) {
        const rel = posix(relative(WEB_ROOT, file));
        if (rel === 'lib/billing/prices.ts' || rel.startsWith(`${posix(BLOG)}/`)) continue;
        const source = readFileSync(file, 'utf8');
        if (Object.hasOwn(PINNED_V1, rel)) {
          expect(unknownPrices(source, rel), rel).toEqual([]);
          continue;
        }
        source.split('\n').forEach((line, i) => {
          if (/^\s*locked:/.test(line)) return;
          for (const [m] of code(line).matchAll(TYPED_PRICE))
            offenders.push(`${rel}:${i + 1} ${m}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('where the blog gives Pro’s price, it is Pro’s', () => {
    const found: string[] = [];
    for (const file of sourceFiles(join(WEB_ROOT, BLOG))) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(
        /\bPro(?: at)?\s+(\$\s*\d+(?:[.,]\d+)?)\s*\/\s*(mo|month|yr|year)\b/g,
      ))
        if (norm(m[1]!) !== formatPlanPrice('pro', /^y/.test(m[2]!) ? 'year' : 'month'))
          found.push(`${posix(relative(WEB_ROOT, file))}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });

  it('every copy module’s strings name only prices.ts’s prices', async () => {
    const dir = join(WEB_ROOT, 'lib', 'v2', 'copy');
    const modules = readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
    expect(modules.length).toBeGreaterThan(20);
    const found: string[] = [];
    for (const f of modules) {
      const mod = (await import(join(dir, f))) as Record<string, unknown>;
      for (const [name, value] of Object.entries(mod))
        for (const s of strings(value))
          for (const d of unknownPrices(s, `lib/v2/copy/${f}`)) found.push(`${f} ${name}: ${d}`);
    }
    expect(found).toEqual([]);
  });

  it('every registry entry renders only prices.ts’s prices, each plan its own', () => {
    const found = COPY_CHANGES.flatMap((c) =>
      // A segment page's entries live in lib/v2/copy/<screen>.ts, which NOT_OUR_PRICES keys by.
      [
        ...unknownPrices(c.rendered, `lib/v2/copy/${c.screen}.ts`),
        ...wrongPlanPrices(c.rendered),
      ].map((d) => `${c.screen} ${JSON.stringify(c.locked)}: ${d}`),
    );
    expect(found).toEqual([]);
    // Home's and the Result's entries move the artboard's $69 to the decided price. (Others with a
    // $69 in their locked text render it elsewhere, or render nothing where the line is left out.)
    for (const screen of ['home', 'result'] as const) {
      const entry = COPY_CHANGES.find((c) => c.screen === screen && c.locked.includes('$69'));
      expect(entry?.rendered, screen).toContain(usd(AGENCY_MONTHLY));
    }
  });

  it('every rendered v2 screen listed names only prices.ts’s prices, each plan its own', () => {
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
    const found = rendered.flatMap(([name, t]) =>
      [...unknownPrices(t), ...wrongPlanPrices(t)].map((d) => `${name}: ${d}`),
    );
    expect(found).toEqual([]);
    // The sweep read prices: the screens show Pro's and Agency's, and name plans with their prices.
    const seen = new Set(rendered.flatMap(([, t]) => [...t.matchAll(DOLLARS)].map(([d]) => d)));
    expect([...seen]).toEqual(expect.arrayContaining([usd(PRO_MONTHLY), usd(AGENCY_MONTHLY)]));
    expect(rendered.some(([, t]) => [...t.matchAll(PLAN_PRICE)].length > 0)).toBe(true);
  });

  it('Home’s Agency card and the Result’s Pro panel show the decided Agency price', () => {
    const agency = `${usd(AGENCY_MONTHLY)} a month`;
    expect(text(homeElement())).toContain(`Agency ${agency}`);
    expect(text(resultElement('bad-site'))).toContain(`your own brand, ${agency}.`);
  });
});

/** A price that is not Agency's monthly one, for the pattern check above. */
const PRO_YEARLY_FOR_TEST = 190;
