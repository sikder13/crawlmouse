/**
 * The structure builders over generated crawls (fast-check): whatever the seven detectors report as
 * detected, a packet is written for it without a throw, and the contract accepts the packet.
 *
 * The generator makes the shapes a crawled site can hold and a hand-built fixture tends not to: a
 * canonical href that is no URL (stored as `{ href, url: null }`), a canonical the crawl never
 * requested, a path with the characters curl reads as a range, an apostrophe or a percent-escape in
 * a path, a page served at a slashed address, a page whose request ended on another page, links
 * recorded from a page that did not answer 200, redirects that loop or stop, and unread facts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FixPacketSchema } from '@crawlmouse/types/v2';
import { site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectStructure } from '../detectors/index.js';
import type { HreflangLink, PageFacts } from '../detectors/types.js';
import { shallowParent } from '../grade/effects.js';
import { spelled } from './html-checks.js';
import { writePacket } from './registry.js';
import { filedLinks, subjectOf } from './structure.js';
import { factsFor } from './test-support/facts.js';
import { expectOwnWords, NOT_A_URL, SERVED } from './test-support/structure.js';

const PATHS = [
  '/',
  '/a',
  '/b',
  '/c',
  '/d',
  "/women's",
  '/caf%C3%A9',
  '/p[1-3]/{a,b}',
  '/list',
  '/list?page=2',
  '/blog',
  '/blog/page/2',
  '/x?a=1&b=2',
];

const pathArb = fc.constantFrom(...PATHS);
const urlArb = fc.oneof(
  pathArb.map(u),
  fc.constantFrom('https://other.test/x', u('/never-crawled')),
);
/** Where a request can end: a page, a page at its slashed address, or elsewhere. */
const finalArb = (path: string) =>
  fc.oneof(
    fc.constant(u(path)),
    fc.constant(path === '/' || path.includes('?') ? u(path) : `${u(path)}/`),
    urlArb,
  );
const hreflangArb: fc.Arbitrary<HreflangLink[] | null> = fc.option(
  fc.array(
    fc.record({
      lang: fc.constantFrom('en', 'fr', 'de', 'x-default', 'en-UK', 'english'),
      href: urlArb,
    }),
    { maxLength: 4 },
  ),
);
const factsArb = (path: string): fc.Arbitrary<Partial<Omit<PageFacts, 'url'>>> =>
  fc.record(
    {
      final_url: fc.option(finalArb(path)),
      links_read: fc.boolean(),
      redirect: fc.option(
        fc.oneof(
          fc.record({ hops: fc.integer({ min: 0, max: 4 }), loop: fc.constant(false) }),
          fc.record({ hops: fc.integer({ min: 1, max: 4 }), loop: fc.constant(true) }),
        ),
      ),
      canonical: fc.option(
        fc.record({ href: fc.option(fc.oneof(urlArb, fc.constantFrom(...NOT_A_URL))) }),
      ),
      simhash: fc.option(fc.constantFrom('0000000000000000', '0000000000000007')),
      hreflang: hreflangArb,
    },
    { requiredKeys: [] },
  );

const pageArb = (path: string): fc.Arbitrary<PageSpec> =>
  fc.record({
    path: fc.constant(path),
    status: fc.constantFrom(200, 200, 200, 200, 301, 404, 503),
    pr: fc.double({ min: 0, max: 1, noNaN: true }),
    links: fc
      .uniqueArray(fc.record({ to: pathArb, generic: fc.boolean() }), {
        maxLength: 6,
        selector: (l) => l.to,
      })
      .map((ls) => ls.filter((l) => l.to !== path)),
    facts: fc.option(factsArb(path), { nil: undefined }),
  });

/**
 * Two things every generated site holds, so that the orphan and the deep-page detectors have
 * something to report whatever else was drawn: a page nothing links to, and a chain five links deep
 * from the homepage. Whether they are reported still depends on the rest of the site: a page the
 * crawl could not read leaves an absence unproven.
 */
const ALONE = '/alone';
const CHAIN = ['/chain-1', '/chain-2', '/chain-3', '/chain-4', '/chain-5'];

const siteArb = fc
  .uniqueArray(pathArb, { minLength: 2, maxLength: PATHS.length })
  .chain((paths) =>
    fc.tuple(
      // one site in two is read whole, so that what is absent from it is proven absent
      fc.boolean(),
      fc.tuple(...['/', ...paths.filter((p) => p !== '/')].map(pageArb)),
    ),
  )
  .map(([whole, [home, ...rest]]) => {
    const drawn = [{ ...home!, status: 200, links: [...(home!.links ?? []), CHAIN[0]!] }, ...rest];
    const pages: PageSpec[] = [
      ...drawn.map((p) =>
        whole
          ? {
              ...p,
              status: p.status === 503 ? 200 : p.status,
              facts: p.facts === undefined ? undefined : { ...p.facts, links_read: true },
            }
          : p,
      ),
      { path: ALONE },
      ...CHAIN.map((path, i) => ({ path, links: i + 1 < CHAIN.length ? [CHAIN[i + 1]!] : [] })),
    ];
    return site(pages);
  });

const TYPES = [
  'canonical_mismatch',
  'deep_pages',
  'duplicate_pagination',
  'generic_anchor_text',
  'hreflang_gap',
  'orphan_pages',
  'redirect_chain',
] as const;

/**
 * The seed is fixed, so the run is the same run every time and what it reaches can be asserted. A
 * free seed made this test fail on the runs that happened to draw no orphan or no deep page.
 */
const RUN = { seed: 20261112, numRuns: 400 } as const;

describe('the structure builders over generated crawls (property)', () => {
  it('write a packet the contract accepts for every record a detector reports as detected', () => {
    const written = new Map<string, number>();
    // deep pages whose estimate's page already links to them on the links as the grade files them:
    // round 2, security finding 2, where the builder threw
    let alreadyLinked = 0;
    // pages answering 200 whose request ended on another crawled page
    let landedOnAPage = 0;
    fc.assert(
      fc.property(siteArb, (input) => {
        const facts = factsFor(input, SERVED);
        const urls = new Set(input.pages.map((p) => p.url));
        landedOnAPage += input.pages.filter(
          (p) =>
            p.status_code === 200 &&
            p.final_url !== null &&
            spelled(p.final_url) !== p.url &&
            urls.has(spelled(p.final_url)),
        ).length;
        for (const record of detectStructure(input)) {
          if (record.state !== 'detected') continue;
          if (record.type === 'deep_pages') {
            const edges = filedLinks(facts);
            const from = shallowParent({ ...input, edges });
            const to = subjectOf(record);
            if (edges.some((e) => e.from_url === from && e.to_url === to)) alreadyLinked++;
          }
          // the registry's writer itself: written.ts catches a throw, and would hide one here
          const packet = writePacket(record.type, record, facts);
          expect(packet).not.toBeNull();
          expect(FixPacketSchema.safeParse(packet).success).toBe(true);
          expect(packet!.verify.command).not.toMatch(/[\r\n]/);
          expect(packet!.verify.see).not.toBeNull();
          // owner rulings 2 and 3: no count of one before a plural, no internal identifier
          expectOwnWords(packet!);
          written.set(record.type, (written.get(record.type) ?? 0) + 1);
        }
      }),
      RUN,
    );
    // the run reaches each of the seven types, so the property is about all of them
    expect([...written.keys()].sort()).toEqual([...TYPES]);
    for (const type of TYPES) expect(written.get(type), type).toBeGreaterThanOrEqual(10);
    expect(alreadyLinked).toBeGreaterThan(0);
    expect(landedOnAPage).toBeGreaterThan(0);
  });
});
