/**
 * The structure builders over generated crawls (fast-check): whatever the seven detectors report as
 * detected, a packet is written for it without a throw, and the contract accepts the packet.
 *
 * The generator makes the shapes a crawled site can hold and a hand-built fixture tends not to: a
 * canonical href that is no URL (stored as `{ href, url: null }`), a canonical the crawl never
 * requested, a path with the characters curl reads as a range, an apostrophe or a percent-escape in
 * a path, a page served at a slashed address, redirects that loop or stop, and unread facts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FixPacketSchema } from '@crawlmouse/types/v2';
import { site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectStructure } from '../detectors/index.js';
import type { HreflangLink, PageFacts } from '../detectors/types.js';
import { writePacket } from './registry.js';
import { factsFor } from './test-support/facts.js';
import { NOT_A_URL, SERVED } from './test-support/structure.js';

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

const siteArb = fc
  .uniqueArray(pathArb, { minLength: 2, maxLength: PATHS.length })
  .chain((paths) => fc.tuple(...['/', ...paths.filter((p) => p !== '/')].map(pageArb)))
  .map((pages) => site(pages));

describe('the structure builders over generated crawls (property)', () => {
  it('write a packet the contract accepts for every record a detector reports as detected', () => {
    const written = new Map<string, number>();
    fc.assert(
      fc.property(siteArb, (input) => {
        const facts = factsFor(input, SERVED);
        for (const record of detectStructure(input)) {
          if (record.state !== 'detected') continue;
          const packet = writePacket(record.type, record, facts);
          expect(packet).not.toBeNull();
          expect(FixPacketSchema.safeParse(packet).success).toBe(true);
          expect(packet!.verify.command).not.toMatch(/[\r\n]/);
          written.set(record.type, (written.get(record.type) ?? 0) + 1);
        }
      }),
      { numRuns: 400 },
    );
    // the generator reaches each of the seven types, so the property is about all of them
    expect([...written.keys()].sort()).toEqual([
      'canonical_mismatch',
      'deep_pages',
      'duplicate_pagination',
      'generic_anchor_text',
      'hreflang_gap',
      'orphan_pages',
      'redirect_chain',
    ]);
  });
});
