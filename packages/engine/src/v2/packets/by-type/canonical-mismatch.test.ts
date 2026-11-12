import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { site, type PageSpec } from '../../../../fixtures/v2/detectors/builders.js';
import { detectCanonicalMismatch } from '../../detectors/canonical-mismatch.js';
import type { Condition, DetectorInput } from '../../detectors/types.js';
import { NO_STACK, factsFor } from '../test-support/facts.js';
import {
  anchors,
  detected,
  expectDeterministic,
  expectHostileSafe,
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

type Shape =
  | 'cross_host'
  | 'redirects'
  | 'redirects_to_unread'
  | 'gone'
  | 'not_canonical'
  | 'disallowed'
  | 'linked'
  | 'redirects_and_linked'
  | 'gone_and_linked';

/** /p declares a canonical that is broken in the way `shape` names; the home page links to /p when it says so. */
function canonicalSite(base: string, shape: Shape): DetectorInput {
  const u = (path: string) => `${base}${path}`;
  const sound = { canonical: { href: null } };
  const linked = shape === 'linked' || shape.endsWith('_and_linked');
  const home: PageSpec = {
    path: base,
    links: linked ? [u('/p'), u('/t2')] : [u('/t2')],
    facts: sound,
  };
  const p = (href: string): PageSpec => ({
    path: u('/p'),
    links: [base],
    facts: { canonical: { href } },
  });
  const t2: PageSpec = { path: u('/t2'), links: [base], facts: { canonical: { href: u('/t2') } } };
  switch (shape) {
    case 'cross_host':
      return site([home, p('https://other.test/p'), t2], { homepage: base });
    case 'redirects':
    case 'redirects_and_linked':
      return site(
        [
          home,
          p(u('/t')),
          t2,
          { path: u('/t'), facts: { final_url: u('/t2/'), canonical: { href: u('/t2') } } },
        ],
        { homepage: base },
      );
    case 'redirects_to_unread':
      return site([home, p(u('/t')), t2, { path: u('/t'), facts: { final_url: u('/t3') } }], {
        homepage: base,
      });
    case 'gone':
    case 'gone_and_linked':
      return site([home, p(u('/t')), t2, { path: u('/t'), status: 404 }], { homepage: base });
    case 'not_canonical':
      return site(
        [
          home,
          p(u('/t')),
          t2,
          { path: u('/t'), links: [base], facts: { canonical: { href: u('/t2') } } },
        ],
        { homepage: base },
      );
    case 'disallowed':
      return site([home, p(u('/t')), t2], { homepage: base, disallowed: [{ path: u('/t') }] });
    case 'linked':
      return site([home, p(u('/t2')), t2], { homepage: base });
  }
}

const packetFor = (input: DetectorInput, base: string, stack = NO_STACK) =>
  packetOf(
    'canonical_mismatch',
    detected(detectCanonicalMismatch(input), `${base}/p`),
    factsFor(input, SERVED, stack),
  );

const base = 'https://a.test';
const DOC =
  "Google's rules for canonical URLs: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls";

describe('the canonical_mismatch packet', () => {
  it.each<[Shape, Condition[], string]>([
    [
      'cross_host',
      ['canonical_cross_host'],
      '`https://other.test/p` is on another host than the page: the canonical asks search engines to index that URL in place of this one.',
    ],
    [
      'redirects',
      ['canonical_target_redirects'],
      '`https://a.test/t` redirects to `https://a.test/t2/`.',
    ],
    [
      'gone',
      ['canonical_target_gone'],
      '`https://a.test/t` answers 404: the page the canonical names is gone.',
    ],
    [
      'not_canonical',
      ['canonical_target_not_canonical'],
      '`https://a.test/t` itself declares another canonical, `https://a.test/t2`.',
    ],
    [
      'disallowed',
      ['canonical_target_disallowed'],
      'robots.txt disallows `https://a.test/t` for Googlebot, Bingbot, so a search engine cannot read the page the canonical names.',
    ],
  ])('says what is wrong with the canonical when it %s', (shape, conditions, sentence) => {
    const input = canonicalSite(base, shape);
    expect(detected(detectCanonicalMismatch(input), `${base}/p`).conditions).toEqual(conditions);
    const declared = shape === 'cross_host' ? 'https://other.test/p' : 'https://a.test/t';
    expect(packetFor(input, base).context).toEqual([
      `\`https://a.test/p\` declares \`${declared}\` as its canonical.`,
      sentence,
      DOC,
    ]);
  });

  it('names the pages that link to the non-canonical URL, and no fault of the canonical it did not prove', () => {
    const p = packetFor(canonicalSite(base, 'linked'), base);
    expect(p.context).toEqual([
      '`https://a.test/p` declares `https://a.test/t2` as its canonical.',
      '1 page links to `https://a.test/p`, a URL that names another as its canonical: `https://a.test`.',
      DOC,
    ]);
    expect(p.change).toEqual([
      'Change the links to `https://a.test/p` on `https://a.test` so that they point at `https://a.test/t2`: Google asks that internal links go to the canonical URL, not to a duplicate.',
      'If `https://a.test/p` is meant to be indexed in its own right, make its canonical its own URL instead; the command below checks the links.',
    ]);
    expect(p.frameworks).toEqual(['generic']);
  });

  it.each<[Shape, string]>([
    ['cross_host', 'https://a.test/p'],
    ['gone', 'https://a.test/p'],
    ['disallowed', 'https://a.test/p'],
    ['redirects_to_unread', 'https://a.test/p'],
    ['redirects', 'https://a.test/t2'],
    ['not_canonical', 'https://a.test/t2'],
  ])('when the canonical %s, expects %s', (shape, expected) => {
    const p = packetFor(canonicalSite(base, shape), base);
    const path = new URL(expected).pathname;
    expect(p.verify.command).toMatch(/^curl -sS -A '[^']*' 'https:\/\/a\.test\/p' \| /);
    expect(p.verify.command.endsWith(` | grep -qxF -e '${expected}' -e '${path}'`)).toBe(true);
    expect(p.change[0]).toContain(
      expected === 'https://a.test/p' ? 'to its own URL' : `to \`${expected}\``,
    );
  });

  it('sends the links to the new canonical too when it is another URL, and leaves them when it is the page', () => {
    const moved = packetFor(canonicalSite(base, 'redirects_and_linked'), base);
    expect(moved.change.at(-1)).toContain('so that they point at `https://a.test/t2`');
    expect(moved.verify.command).toContain(" && curl -sS -A '");
    const kept = packetFor(canonicalSite(base, 'gone_and_linked'), base);
    expect(kept.change.join(' ')).not.toContain('Change the links');
    expect(kept.keep.at(-1)).toBe(
      'Keep the links to `https://a.test/p`: once it is its own canonical they point at the canonical URL.',
    );
    expect(kept.verify.command).not.toContain('&&');
  });

  it('writes a Next.js body when the canonical itself changes, citing the page it rests on', () => {
    const p = packetFor(canonicalSite(base, 'gone'), base);
    expect(p.frameworks).toEqual(['generic', 'nextjs']);
    expect(p.packets[0]!.change[0]).toBe(
      'In the App Router the tag comes from alternates.canonical in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it. Set it there so that `https://a.test/p` declares its own URL.',
    );
    expect(packetFor(canonicalSite(base, 'linked'), base).frameworks).toEqual(['generic']);
  });

  const page = (canonical: string) =>
    `<html><head><link rel="canonical" href="${canonical}"></head><body><a href="/">home</a></body></html>`;

  describe.each<[Shape, string]>([
    ['cross_host', '/p'],
    ['gone', '/p'],
    ['disallowed', '/p'],
    ['redirects', '/t2'],
    ['not_canonical', '/t2'],
  ])('verify, when the canonical %s', (shape, fixedCanonical) => {
    it('fails on the declared canonical and passes on the expected one', async () => {
      const bad = shape === 'cross_host' ? 'https://other.test/p' : '/t';
      served = await servedSite({
        broken: { '/p': page(bad) },
        fixed: { '/p': page(fixedCanonical) },
      });
      const p = packetFor(canonicalSite(served.base, shape), served.base);
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });

  it('verify, for links under a non-canonical URL, fails until the linking page links to the canonical', async () => {
    served = await servedSite({
      broken: { '/': anchors(['/p', '/t2']), '/p': page('/t2') },
      fixed: { '/': anchors(['/t2']), '/p': page('/t2') },
    });
    const p = packetFor(canonicalSite(served.base, 'linked'), served.base);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it.each([
    ['only the canonical mended', { '/': anchors(['/p']), '/p': page('/t2') }],
    ['only the links mended', { '/': anchors(['/t2']), '/p': page('/t') }],
  ])(
    'verify, when the canonical and the links both change, is not passed by %s',
    async (_n, half) => {
      served = await servedSite({ broken: half, fixed: half });
      const p = packetFor(canonicalSite(served.base, 'redirects_and_linked'), served.base);
      expect((await inBothStates(served, p.verify.command)).fixed.status).not.toBe(0);
    },
  );

  it('verify, when the canonical and the links both change, passes once both are mended', async () => {
    served = await servedSite({
      broken: { '/': anchors(['/p', '/t2']), '/p': page('/t') },
      fixed: { '/': anchors(['/t2']), '/p': page('/t2') },
    });
    const p = packetFor(canonicalSite(served.base, 'redirects_and_linked'), served.base);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });
});

describe('the canonical_mismatch packet over hostile records (properties)', () => {
  const TARGET: Condition[] = [
    'canonical_cross_host',
    'canonical_target_redirects',
    'canonical_target_gone',
    'canonical_target_not_canonical',
    'canonical_target_disallowed',
  ];
  const arb = fc.record({
    page: hostileUrl(),
    declared: hostileUrl('https://b.test'),
    onward: hostileUrl(),
    target: fc.option(fc.constantFrom(...TARGET), { nil: null }),
    linking: fc.uniqueArray(hostileUrl(), { maxLength: 10 }),
    framework: fc.constantFrom(null, 'nextjs' as const),
  });
  type Rec = typeof arb extends fc.Arbitrary<infer T> ? T : never;
  const build = ({ page, declared, onward, target, linking, framework }: Rec) => {
    const input = canonicalSite('https://a.test', 'linked');
    const record = { ...detected(detectCanonicalMismatch(input), 'https://a.test/p') };
    const from = linking.filter((l) => l !== page).sort();
    const conditions: Condition[] = [
      ...(target === null ? [] : [target]),
      ...(from.length > 0 ? (['linked_under_non_canonical'] as const) : []),
    ];
    record.key = `canonical:${page}`;
    record.conditions = conditions.sort();
    record.measured = from.length;
    record.affected_urls = [page];
    record.evidence = {
      pages: [page, declared].sort(),
      edges: from.map((from_url) => ({ from_url, to_url: page })),
    };
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
      pages: new Map([
        [page, pageAt(page, { canonical_declared: { href: declared, url: declared } })],
        [
          declared,
          pageAt(declared, {
            status_code: target === 'canonical_target_gone' ? 404 : 200,
            final_url: onward,
            canonical_declared: { href: onward, url: onward },
          }),
        ],
        [onward, pageAt(onward, { canonical_declared: { href: null, url: null } })],
      ]),
    };
    return { record, facts };
  };

  it('lets nothing crawled out of a code span or a quoted word, and adds no line', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        fc.pre(record.conditions.length > 0 && r.page !== r.declared && r.page !== r.onward);
        expectHostileSafe(packetOf('canonical_mismatch', record, facts));
      }),
    );
  });

  it('gives the same packet for the same record and facts', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        fc.pre(record.conditions.length > 0 && r.page !== r.declared && r.page !== r.onward);
        expectDeterministic('canonical_mismatch', record, facts);
      }),
    );
  });
});
