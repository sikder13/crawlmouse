import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { simhashAway, site } from '../../../../fixtures/v2/detectors/builders.js';
import { detectDuplicatePagination, firstPageOf } from '../../detectors/duplicate-pagination.js';
import type { Condition, DetectorInput } from '../../detectors/types.js';
import { canonicalizeUrl } from '../../../url-canonical.js';
import { factsFor } from '../test-support/facts.js';
import {
  detected,
  expectDeterministic,
  expectHostileSafe,
  hostile,
  MARK,
  packetOf,
  pageAsRead,
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

const HASH = '0123456789abcdef';
const TEMPLATE = '/collections/{slug}';

type Fault = 'canonical' | 'content' | 'both';

/** A list whose page 2 declares page 1 as canonical, repeats its content, or both. */
function listSite(base: string, fault: Fault, later = '/collections/tents?page=2'): DetectorInput {
  const first = `${base}/collections/tents`;
  const second = `${base}${later}`;
  return site(
    [
      { path: base, links: [first] },
      { path: first, links: [second], facts: { simhash: HASH, canonical: { href: first } } },
      {
        path: second,
        template: TEMPLATE,
        links: [first],
        facts: {
          simhash: simhashAway(HASH, fault === 'canonical' ? 30 : 1),
          canonical: { href: fault === 'content' ? second : first },
        },
      },
    ],
    { homepage: base },
  );
}

const packetFor = (input: DetectorInput) =>
  packetOf(
    'duplicate_pagination',
    detected(detectDuplicatePagination(input), TEMPLATE),
    factsFor(input, SERVED),
  );

describe('the duplicate_pagination packet', () => {
  const base = 'https://a.test';
  const later = '`https://a.test/collections/tents?page=2`';

  it('names the template and the later pages, then one sentence for each condition proved', () => {
    expect(packetFor(listSite(base, 'canonical')).context).toEqual([
      `Template \`/collections/{slug}\`: 1 later page of a paginated list repeats its first page: ${later}.`,
      `Canonical set to the first page of the list: ${later}.`,
      'Google asks that each page of a sequence have its own canonical, and that the first page not be the canonical of the others: https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading',
    ]);
    expect(packetFor(listSite(base, 'content')).context).toEqual([
      `Template \`/collections/{slug}\`: 1 later page of a paginated list repeats its first page: ${later}.`,
      `Main content nearly identical to the first page's (64-bit content hashes within 3 bits): ${later}.`,
    ]);
  });

  it('does not say which page repeats the content when the record does not', () => {
    const p = packetFor(listSite(base, 'both'));
    expect(p.context[1]).toBe(`Canonical set to the first page of the list: ${later}.`);
    expect(p.context[3]).toBe(
      "At least one of the pages above also has main content nearly identical to its first page's (64-bit content hashes within 3 bits).",
    );
  });

  it('says of each page what its own row shows, when two lists of a template differ', () => {
    const u = (path: string) => `${base}${path}`;
    const input = site(
      [
        { path: base, links: [u('/collections/tents'), u('/collections/stoves')] },
        ...['tents', 'stoves'].map((name) => ({
          path: u(`/collections/${name}`),
          links: [u(`/collections/${name}?page=2`)],
          facts: { simhash: HASH, canonical: { href: u(`/collections/${name}`) } },
        })),
        {
          path: u('/collections/tents?page=2'),
          template: TEMPLATE,
          facts: { simhash: simhashAway(HASH, 30), canonical: { href: u('/collections/tents') } },
        },
        {
          path: u('/collections/stoves?page=2'),
          template: TEMPLATE,
          facts: {
            simhash: simhashAway(HASH, 2),
            canonical: { href: u('/collections/stoves?page=2') },
          },
        },
      ],
      { homepage: base },
    );
    const p = packetFor(input);
    expect(p.context.slice(1)).toEqual([
      'Canonical set to the first page of the list: `https://a.test/collections/tents?page=2`.',
      'Google asks that each page of a sequence have its own canonical, and that the first page not be the canonical of the others: https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading',
      "Main content nearly identical to the first page's (64-bit content hashes within 3 bits): `https://a.test/collections/stoves?page=2`.",
    ]);
    // the first page marked is the stoves list's, which keeps its own canonical: the command leaves the canonical out
    expect(p.verify.command).not.toContain('"canonical"');
    expect(packetFor(listSite(base, 'canonical')).verify.command).toContain('"canonical"');
    expect(p.verify.expect).toContain('The command reads the first of the later pages');
  });

  it('writes a step for each condition, and none for a condition not proved', () => {
    const canonical = packetFor(listSite(base, 'canonical')).change;
    const content = packetFor(listSite(base, 'content')).change;
    expect(canonical).toEqual([
      `Give each later page its own canonical: on ${later}, set rel="canonical" to that page's own URL in place of the first page's.`,
    ]);
    expect(content).toEqual([
      'Make each later page list its own items. A later page that serves the first page again usually means the page number in the URL does not reach the query that builds the list.',
    ]);
    expect(packetFor(listSite(base, 'both')).change).toEqual([...canonical, ...content]);
    expect(packetFor(listSite(base, 'both')).frameworks).toEqual(['generic']);
  });

  it('checks the canonical with one request, the content with the two pages, and both when both are proved', () => {
    const canonical = packetFor(listSite(base, 'canonical')).verify.command;
    const content = packetFor(listSite(base, 'content')).verify.command;
    expect(canonical).toMatch(
      /^curl -sS -A '[^']*' 'https:\/\/a\.test\/collections\/tents\?page=2' \| LC_ALL=C awk '.*' 'https:\/\/a\.test' 'https:\/\/a\.test\/collections\/tents\?page=2'$/,
    );
    expect(content).toMatch(
      /^curl -sS -A '[^']*' -w '\\ncrawlmouse:end\\n' 'https:\/\/a\.test\/collections\/tents' 'https:\/\/a\.test\/collections\/tents\?page=2' \| LC_ALL=C awk '.*' 'https:\/\/a\.test' 'page=' 'https:\/\/a\.test\/collections\/tents'$/,
    );
    expect(packetFor(listSite(base, 'both')).verify.command).toBe(`${canonical} && ${content}`);
  });

  it('marks the other pages of a list written as a path by its page segment', () => {
    const p = packetFor(listSite(base, 'content', '/collections/tents/page/2'));
    expect(p.verify.command).toMatch(
      /' 'https:\/\/a\.test' '\/page\/' 'https:\/\/a\.test\/collections\/tents'$/,
    );
  });

  const LIST = '/collections/tents';
  const LATER = `${LIST}?page=2`;
  const html = (canonical: string, links: string[]) =>
    `<html><head><link rel="canonical" href="${canonical}"></head><body>${links
      .map((l) => `<a href="${l}">${l}</a>`)
      .join('')}</body></html>`;
  /** Page 1, and page 2 with the canonical and the items given. */
  const list = (canonical: string, items: string[]) => ({
    [LIST]: html(LIST, [LATER, '/products/ridge', '/products/dome']),
    [LATER]: html(canonical, [LIST, `${LIST}?page=3`, ...items]),
  });
  const REPEATED = ['/products/ridge', '/products/dome'];
  const OWN = ['/products/alpine', '/products/trail'];
  const BROKEN: Record<Fault, ReturnType<typeof list>> = {
    canonical: list(LIST, OWN),
    content: list(LATER, REPEATED),
    both: list(LIST, REPEATED),
  };

  describe.each<Fault>(['canonical', 'content', 'both'])(
    'verify, when page 2 repeats page 1 by %s',
    (fault) => {
      it('fails on the broken site and passes on the fixed one', async () => {
        served = await servedSite({ broken: BROKEN[fault], fixed: list(LATER, OWN) });
        const p = packetFor(listSite(served.base, fault));
        const { broken, fixed } = await inBothStates(served, p.verify.command);
        expect(broken.status).not.toBe(0);
        expect(fixed.status).toBe(0);
      });
    },
  );

  it.each([
    ['only the canonical mended', list(LATER, REPEATED)],
    ['only the content mended', list(LIST, OWN)],
  ])('verify, when both are proved, is not passed by %s', async (_name, half) => {
    served = await servedSite({ broken: half, fixed: half });
    const p = packetFor(listSite(served.base, 'both'));
    expect((await inBothStates(served, p.verify.command)).fixed.status).not.toBe(0);
  });

  it('verify is not passed by a later page whose only new links are to the list itself', async () => {
    const pages = {
      [LIST]: html(LIST, ['/products/ridge']),
      [LATER]: html(LATER, [LIST, `${LIST}?page=3`, `${LIST}?page=4`, '/products/ridge']),
    };
    served = await servedSite({ broken: pages, fixed: pages });
    const p = packetFor(listSite(served.base, 'content'));
    expect((await inBothStates(served, p.verify.command)).fixed.status).not.toBe(0);
  });

  // the round 1 SEO review's inputs
  it.each([
    [
      'an unfixed page 2 that carries a sort link page 1 lacks',
      list(LATER, [...REPEATED, `${LIST}?sort=price`]),
    ],
    ['the same items with one unrelated link added', list(LATER, [...REPEATED, '/about'])],
    ['a later page that now answers 404', { [LIST]: list(LATER, OWN)[LIST]! }],
  ])('verify is not passed by %s', async (_name, pages) => {
    served = await servedSite({ broken: pages, fixed: pages });
    const p = packetFor(listSite(served.base, 'content'));
    expect((await inBothStates(served, p.verify.command)).fixed.status).not.toBe(0);
  });

  it('asks for no step its own command does not pass, and says what the command compares', () => {
    const p = packetFor(listSite(base, 'content'));
    expect([...p.change, ...p.keep].join(' ')).not.toMatch(/404/);
    expect(p.verify.expect).toBe(
      "Exit status 0 once `https://a.test/collections/tents?page=2` and `https://a.test/collections/tents` each link to a page the other does not link to, links to the list's own pages left out. A later page that repeats the first has every link the first has, so it does not pass. The command compares links; the content hash the audit measures is measured again on the next check.",
    );
  });

  it('on a site that serves its pages with a trailing slash, requests both pages as served', async () => {
    const slashedList = (canonical: string, items: string[]) => ({
      [`${LIST}/`]: html(`${LIST}/`, [`${LIST}/?page=2`, '/products/ridge/', '/products/dome/']),
      [`${LIST}/?page=2`]: html(canonical, [`${LIST}/`, ...items]),
    });
    served = await servedSite({
      broken: slashedList(`${LIST}/`, ['/products/ridge/', '/products/dome/']),
      fixed: slashedList(`${LIST}/?page=2`, ['/products/alpine/']),
    });
    const b = served.base;
    const input = listSite(b, 'both');
    const facts = factsFor(input, SERVED);
    const pages = new Map(
      [...facts.pages].map(([url, row]) => [
        url,
        url === b ? row : { ...row, final_url: url.replace(LIST, `${LIST}/`) },
      ]),
    );
    const p = packetOf(
      'duplicate_pagination',
      detected(detectDuplicatePagination(input), TEMPLATE),
      { ...facts, pages },
    );
    expect(p.verify.command).toContain(` '${b}${LIST}/' '${b}${LIST}/?page=2' | `);
    expect(p.verify.expect).toContain(`the <head> of \`${b}${LIST}/?page=2\` holds one`);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('agrees with the engine’s own reading of the pages served', async () => {
    const states = { broken: list(LIST, OWN), fixed: list(LATER, OWN) };
    served = await servedSite(states);
    const b = served.base;
    const read = (state: 'broken' | 'fixed') =>
      site(
        [
          { path: b, links: [`${b}${LIST}`] },
          pageAsRead(`${b}${LIST}`, states[state][LIST]!, { facts: { simhash: HASH } }),
          pageAsRead(`${b}${LATER}`, states[state][LATER]!, {
            template: TEMPLATE,
            facts: { simhash: simhashAway(HASH, 30) },
          }),
        ],
        { homepage: b },
      );
    const p = packetFor(read('broken'));
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(detectDuplicatePagination(read('fixed')).filter((r) => r.state === 'detected')).toEqual(
      [],
    );
  });
});

describe('the duplicate_pagination packet over hostile records (properties)', () => {
  const arb = fc.record({
    template: hostile().map((t) => `/${t}`),
    lists: fc.uniqueArray(hostile(2), { minLength: 1, maxLength: 10 }),
    conditions: fc.constantFrom<Condition[]>(
      ['pagination_canonical_to_first'],
      ['pagination_near_duplicate'],
      ['pagination_canonical_to_first', 'pagination_near_duplicate'],
    ),
    toFirst: fc.boolean(),
  });
  type Rec = typeof arb extends fc.Arbitrary<infer T> ? T : never;
  /** A later page of a list with a hostile name; a name the pagination rule does not read falls back. */
  const laterOf = (name: string) => {
    const plain = `https://a.test/${MARK}?page=2`;
    try {
      const url = canonicalizeUrl(
        `https://a.test/${name.replace(/[#?]/g, '')}?page=2&q=${name.replace(/#/g, '')}`,
      );
      return firstPageOf(url) === null ? plain : url;
    } catch {
      return plain;
    }
  };
  const build = ({ template, lists, conditions, toFirst }: Rec) => {
    const later = [...new Set(lists.map(laterOf))].sort();
    const input = listSite('https://a.test', 'both');
    const record = { ...detected(detectDuplicatePagination(input), TEMPLATE) };
    record.key = `pagination:${template}`;
    record.conditions = conditions;
    record.measured = later.length;
    record.affected_urls = later;
    record.evidence = { pages: later, edges: [] };
    const facts: PacketFacts = {
      ...factsFor(input, SERVED),
      pages: new Map(
        later.map((u, i) => {
          const first = firstPageOf(u)!;
          // the detector's record has a page declaring page 1 whenever it proves that condition
          const declares =
            conditions.includes('pagination_canonical_to_first') && (i === 0 || toFirst);
          return [
            u,
            pageAt(u, { canonical_declared: declares ? { href: first, url: first } : null }),
          ];
        }),
      ),
    };
    return { record, facts };
  };

  it('lets nothing crawled out of a code span or a quoted word, and adds no line', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectHostileSafe(packetOf('duplicate_pagination', record, facts));
      }),
    );
  });

  it('gives the same packet for the same record and facts', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectDeterministic('duplicate_pagination', record, facts);
      }),
    );
  });
});
