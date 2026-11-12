import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { site, type PageSpec } from '../../../../fixtures/v2/detectors/builders.js';
import { detectHreflangGaps } from '../../detectors/hreflang-gaps.js';
import type { Condition, DetectorInput, HreflangLink } from '../../detectors/types.js';
import { canonicalizeUrl } from '../../../url-canonical.js';
import { NO_STACK, factsFor } from '../test-support/facts.js';
import {
  detected,
  expectDeterministic,
  expectHostileSafe,
  hostile,
  hostileUrl,
  packetOf,
  pageAt,
  SERVED,
  servedSite,
} from '../test-support/structure.js';
import { inBothStates, type TwoStateSite } from '../test-support/verify.js';
import type { PacketFacts } from '../types.js';

let served: TwoStateSite | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

type Shape = Extract<Condition, `hreflang_${string}`>;
type Links = [lang: string, path: string][];

/** What /de and /en annotate, by the defect the cluster shows; /de is the cluster's lowest URL. */
const BROKEN: Record<Shape, { en: Links; de: Links }> = {
  hreflang_missing_self: {
    en: [
      ['de', '/de'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_missing_x_default: {
    en: [
      ['en', '/en'],
      ['de', '/de'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_invalid_code: {
    en: [
      ['en-UK', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_missing_return: {
    en: [
      ['en', '/en'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_alternate_redirects: {
    en: [
      ['en', '/en'],
      ['de', '/de'],
      ['fr', '/fr'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_alternate_gone: {
    en: [
      ['en', '/en'],
      ['de', '/de'],
      ['fr', '/fr'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
};
const FIXED: Links = [
  ['en', '/en'],
  ['de', '/de'],
  ['x-default', '/en'],
];

function cluster(
  base: string,
  shape: Shape,
  over: Partial<{ en: Links; de: Links }> = {},
): DetectorInput {
  const links = (ls: Links): HreflangLink[] =>
    ls.map(([lang, path]) => ({ lang, href: `${base}${path}` }));
  const { en, de } = { ...BROKEN[shape], ...over };
  const fr: PageSpec[] =
    shape === 'hreflang_alternate_redirects'
      ? [{ path: `${base}/fr`, facts: { final_url: `${base}/fr-fr` } }]
      : shape === 'hreflang_alternate_gone'
        ? [{ path: `${base}/fr`, status: 404 }]
        : [];
  return site(
    [
      { path: base, links: [`${base}/en`, `${base}/de`] },
      { path: `${base}/en`, facts: { hreflang: links(en) } },
      { path: `${base}/de`, facts: { hreflang: links(de) } },
      ...fr,
    ],
    { homepage: base },
  );
}

const packetFor = (input: DetectorInput, base: string, stack = NO_STACK) =>
  packetOf(
    'hreflang_gap',
    detected(detectHreflangGaps(input), `${base}/de`),
    factsFor(input, SERVED, stack),
  );

const base = 'https://a.test';
const DOC =
  "Google's rules for hreflang: https://developers.google.com/search/docs/specialty/international/localized-versions";

describe('the hreflang_gap packet', () => {
  it.each<[Shape, string, string]>([
    [
      'hreflang_missing_self',
      'https://a.test/en',
      'It does not list itself among its own annotations under a language code.',
    ],
    [
      'hreflang_missing_x_default',
      'https://a.test/en',
      'It has no x-default annotation. Google recommends one and does not require it.',
    ],
    [
      'hreflang_invalid_code',
      'https://a.test/en',
      'It uses an hreflang value that is not a valid code: `en-UK`.',
    ],
    [
      'hreflang_missing_return',
      'https://a.test/en',
      'It is named as an alternate by another page of the cluster and does not name that page back. Google ignores annotations that do not point both ways.',
    ],
    ['hreflang_alternate_redirects', 'https://a.test/en', 'It names an alternate that redirects.'],
    [
      'hreflang_alternate_gone',
      'https://a.test/en',
      'It names an alternate that answers 404 or 410.',
    ],
  ])('says what %s means, of the one page the record marks', (shape, marked, sentence) => {
    const input = cluster(base, shape);
    const record = detected(detectHreflangGaps(input), `${base}/de`);
    expect(record.conditions).toEqual([shape]);
    expect(record.affected_urls).toEqual([marked]);
    const members = record.evidence.pages.length;
    expect(packetFor(input, base).context).toEqual([
      `The hreflang annotations join \`https://a.test/de\` and ${members - 1} other crawled ${members === 2 ? 'page' : 'pages'} into one cluster. 1 of the ${members} carries a defect: \`${marked}\`.`,
      sentence,
      DOC,
    ]);
  });

  it('does not say which page carries which condition when the record marks more than one', () => {
    const input = cluster(base, 'hreflang_missing_self', {
      de: [
        ['en', '/en'],
        ['de', '/de'],
      ],
    });
    const record = detected(detectHreflangGaps(input), `${base}/de`);
    expect(record.affected_urls).toEqual(['https://a.test/de', 'https://a.test/en']);
    expect(record.conditions).toEqual(['hreflang_missing_self', 'hreflang_missing_x_default']);
    expect(packetFor(input, base).context).toEqual([
      'The hreflang annotations join `https://a.test/de` and 1 other crawled page into one cluster. 2 of the 2 carry a defect: `https://a.test/de`, `https://a.test/en`.',
      'At least one of them does not list itself among its own annotations under a language code.',
      'At least one of them has no x-default annotation. Google recommends one and does not require it.',
      DOC,
    ]);
  });

  it('writes a step for each condition proved, after the rule for the whole cluster', () => {
    const p = packetFor(cluster(base, 'hreflang_invalid_code'), base);
    expect(p.change).toEqual([
      'Give every page of the cluster the same full set of annotations: one <link rel="alternate" hreflang="…" href="…"> in the <head> for each language version, the page itself included, each with an absolute URL.',
      'Write each hreflang value as an ISO 639-1 language code, optionally followed by an ISO 15924 script and an ISO 3166-1 alpha-2 region: en, en-GB, zh-Hant-TW. A region alone is not valid.',
    ]);
    expect(p.keep).toEqual([
      'Keep each page at its URL, and keep the annotations of the pages that carry no defect in step with the ones you change: every page lists the same set.',
    ]);
  });

  it('writes a Next.js body that says where the annotations come from, then the same steps', () => {
    const p = packetFor(cluster(base, 'hreflang_invalid_code'), base);
    expect(p.frameworks).toEqual(['generic', 'nextjs']);
    expect(p.packets[0]!.change).toEqual([
      'In the App Router the annotations come from alternates.languages (an hreflang value to a URL) in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it. Make the changes below there.',
      ...p.change,
    ]);
  });

  it('asks the command for what the first marked page lacks, read from its own annotations', () => {
    const invalid = packetFor(cluster(base, 'hreflang_invalid_code'), base).verify;
    expect(invalid.command).toMatch(/^curl -sS -A '[^']*' 'https:\/\/a\.test\/en' \| /);
    expect(invalid.command.endsWith("' 'https://a.test/en' '0' 'en-UK'")).toBe(true);
    const back = packetFor(cluster(base, 'hreflang_missing_return'), base).verify;
    expect(back.command.endsWith("' 'https://a.test/en' '1' 'https://a.test/de'")).toBe(true);
    expect(back.expect).toBe(
      'Exit status 0 once `https://a.test/en` lists itself under a language code, holds an x-default, names `https://a.test/de`. Annotations are read from <link> elements with quoted, absolute URLs.',
    );
    const gone = packetFor(cluster(base, 'hreflang_alternate_gone'), base).verify;
    expect(gone.command.endsWith("' 'https://a.test/en' '0' 'https://a.test/fr'")).toBe(true);
    expect(gone.expect).toContain(', and no longer holds `https://a.test/fr`.');
  });

  const head = (ls: Links, origin: string) =>
    `<html><head>${ls
      .map(([lang, path]) => `<link rel="alternate" hreflang="${lang}" href="${origin}${path}">`)
      .join('\n')}</head><body></body></html>`;

  describe.each(Object.keys(BROKEN) as Shape[])('verify, for %s', (shape) => {
    it('fails on the annotations as crawled and passes on the full set', async () => {
      // the pages name the site's own origin, which is known once it listens
      let origin = '';
      served = await servedSite({
        broken: {
          get '/en'() {
            return head(BROKEN[shape].en, origin);
          },
        },
        fixed: {
          get '/en'() {
            return head(FIXED, origin);
          },
        },
      });
      origin = served.base;
      const p = packetFor(cluster(origin, shape), origin);
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });
});

describe('the hreflang_gap packet over hostile records (properties)', () => {
  const arb = fc.record({
    members: fc.uniqueArray(hostileUrl(), { minLength: 2, maxLength: 6 }),
    langs: fc.array(hostile(1), { minLength: 1, maxLength: 4 }),
    conditions: fc.subarray<Shape>(Object.keys(BROKEN) as Shape[], { minLength: 1 }),
    framework: fc.constantFrom(null, 'nextjs' as const),
  });
  type Rec = typeof arb extends fc.Arbitrary<infer T> ? T : never;
  const build = ({ members, langs, conditions, framework }: Rec) => {
    // a record holds URLs in the engine's spelling
    const sorted = [...new Set(members.map((m) => canonicalizeUrl(m)))].sort();
    const input = cluster('https://a.test', 'hreflang_missing_self');
    const record = { ...detected(detectHreflangGaps(input), 'https://a.test/de') };
    record.key = `hreflang:${sorted[0]!}`;
    record.conditions = [...conditions].sort();
    record.measured = sorted.length;
    record.affected_urls = sorted;
    record.evidence = { pages: sorted, edges: [] };
    const facts: PacketFacts = {
      ...factsFor(
        input,
        SERVED,
        framework === null
          ? NO_STACK
          : {
              ...NO_STACK,
              frontend: {
                name: 'x',
                framework,
                version: null,
                router: null,
                detected_from: 'a test',
              },
            },
      ),
      // each member names the next one, under a hostile value, and not itself
      pages: new Map(
        sorted.map((url, i) => [
          url,
          pageAt(url, {
            hreflang: {
              links: langs.map((hreflang) => ({
                hreflang,
                href: sorted[(i + 1) % sorted.length]!,
              })),
              complete: true,
            },
          }),
        ]),
      ),
    };
    return { record, facts };
  };

  it('lets nothing crawled out of a code span or a quoted word, and adds no line', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectHostileSafe(packetOf('hreflang_gap', record, facts));
      }),
    );
  });

  it('gives the same packet for the same record and facts', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectDeterministic('hreflang_gap', record, facts);
      }),
    );
  });
});
