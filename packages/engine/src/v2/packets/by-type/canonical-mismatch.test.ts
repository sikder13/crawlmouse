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
  hostile,
  hostileUrl,
  NOT_A_URL,
  packetOf,
  pageAsRead,
  pageAt,
  SERVED,
  servedSite,
  SPELLINGS,
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
const GOOGLE =
  'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls';

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
    ]);
  });

  it('names the pages that link to the non-canonical URL, and no fault of the canonical it did not prove', () => {
    const p = packetFor(canonicalSite(base, 'linked'), base);
    expect(p.context).toEqual([
      '`https://a.test/p` declares `https://a.test/t2` as its canonical.',
      '1 page links to `https://a.test/p`, a URL that names another as its canonical: `https://a.test`.',
    ]);
    expect(p.change).toEqual([
      `Change the links to \`https://a.test/p\` on \`https://a.test\` so that they point at \`https://a.test/t2\`. Google: "When linking within your site, link to the canonical URL rather than a duplicate URL" (${GOOGLE}).`,
      'Where a link is meant to open this URL as a variant (a filter, a sort order, a tracked link), leaving it is a choice the canonical already covers; the command below stays non-zero while such a link is on the page it reads.',
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
    expect(p.verify.command).toMatch(
      /^curl -sS -A '[^']*' 'https:\/\/a\.test\/p' \| LC_ALL=C awk '/,
    );
    expect(p.verify.command.endsWith(`' 'https://a.test' '${expected}'`)).toBe(true);
    expect(p.change.join(' ')).toContain(
      expected === 'https://a.test/p'
        ? 'et the rel="canonical" of `https://a.test/p` to its own URL.'
        : `Set the rel="canonical" of \`https://a.test/p\` to \`${expected}\``,
    );
    expect(p.context.join(' ')).not.toContain('developers.google.com');
  });

  it('sends the links to the new canonical too when it is another URL, and leaves them when it is the page', () => {
    const moved = packetFor(canonicalSite(base, 'redirects_and_linked'), base);
    expect(moved.change.join(' ')).toContain('so that they point at `https://a.test/t2`');
    expect(moved.verify.command).toContain(" && curl -sS -A '");
    const kept = packetFor(canonicalSite(base, 'gone_and_linked'), base);
    expect(kept.change.join(' ')).not.toContain('Change the links');
    expect(kept.keep.at(-1)).toBe(
      'Keep the links to `https://a.test/p`: once it is its own canonical they point at the canonical URL.',
    );
    expect(kept.verify.command).not.toContain(' && curl ');
  });

  it('writes a Next.js body when the canonical itself changes, citing the page it rests on', () => {
    const p = packetFor(canonicalSite(base, 'gone'), base);
    expect(p.frameworks).toEqual(['generic', 'nextjs']);
    const next = p.packets[0]!;
    expect(next.change.slice(0, 3)).toEqual([
      'These steps are for the App Router (the app directory). There the tag comes from alternates.canonical in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it.',
      'Set the rel="canonical" of `https://a.test/p` to its own URL.',
      "If another live URL of this site is the one meant to be indexed for this content, name that one instead; the command below checks for the page's own URL.",
    ]);
    // setting alternates.canonical in a page drops a layout's alternates.languages: the body says so
    expect(next.change[3]).toContain(
      'a segment that sets alternates replaces the whole alternates object of the layouts above it',
    );
    expect(next.keep.at(-1)).toBe(
      'Keep the other fields of alternates the page has today (languages, media, types).',
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

/** The home page links to `path`, which declares `href` as its canonical; `others` are further pages. */
function linkedSite(base: string, href: string, others: PageSpec[] = [], path = '/p') {
  const u = (at: string) => `${base}${at}`;
  return site(
    [
      { path: base, links: [u(path), u('/t2')], facts: { canonical: { href: null } } },
      { path: u(path), links: [base], facts: { canonical: { href } } },
      { path: u('/t2'), links: [base], facts: { canonical: { href: u('/t2') } } },
      ...others,
    ],
    { homepage: base },
  );
}

describe('a canonical no fault is proven of, on a page the site links to', () => {
  const head = (canonical: string) =>
    `<html><head><link rel="canonical" href="${canonical}"></head><body></body></html>`;

  // the round 1 security review's inputs: the worker stores each as { href, url: null }
  describe.each(NOT_A_URL)('declared as %s, which is no URL', (href) => {
    const input = linkedSite(base, href);
    const record = detected(detectCanonicalMismatch(input), `${base}/p`);

    it('is written a packet that asks for the page’s own URL and moves no link', () => {
      expect(record.conditions).toEqual(['linked_under_non_canonical']);
      expect(input.pages.find((p) => p.url === `${base}/p`)!.canonical_declared).toEqual({
        href,
        url: null,
      });
      const p = packetOf('canonical_mismatch', record, factsFor(input, SERVED));
      expect(p.context.at(-1)).toBe(
        `\`${href}\` is not an http or https URL, so it names no page.`,
      );
      expect(p.change[0]).toMatch(
        /^Set the rel="canonical" of `https:\/\/a\.test\/p` to its own URL, or check /,
      );
      expect(p.change.join(' ')).not.toContain('Change the links');
      expect(p.verify.command.endsWith(`' 'https://a.test' 'https://a.test/p'`)).toBe(true);
    });

    it('verify fails on the declared canonical and passes on the page’s own', async () => {
      served = await servedSite({
        broken: { '/p': head(href) },
        fixed: { '/p': head('/p') },
      });
      const p = packetFor(linkedSite(served.base, href), served.base);
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });

  it.each<[string, PageSpec[], string]>([
    [
      'the crawl never requested',
      [],
      'The crawl holds no page that answered at `https://a.test/t`, so the audit cannot say the canonical names a live page.',
    ],
    [
      'answered 503',
      [{ path: `${base}/t`, status: 503 }],
      "The crawl's request for `https://a.test/t` ended with status 503, so the audit cannot say the canonical names a live page.",
    ],
  ])('does not send the links to a canonical that %s', (_name, others, why) => {
    const input = linkedSite(base, `${base}/t`, others);
    const record = detected(detectCanonicalMismatch(input), `${base}/p`);
    expect(record.conditions).toEqual(['linked_under_non_canonical']);
    const p = packetOf('canonical_mismatch', record, factsFor(input, SERVED));
    expect(p.context.at(-1)).toBe(why);
    expect(p.change.join(' ')).not.toContain('Change the links');
    expect(p.change[0]).toContain('to its own URL, or check `https://a.test/t` by hand');
    expect(p.keep.at(-1)).toContain('Keep the links to `https://a.test/p`');
    expect(p.frameworks).toEqual(['generic', 'nextjs']);
  });

  it('sends the links to a canonical the check holds answering 200 at itself', () => {
    const p = packetFor(linkedSite(base, `${base}/t2`), base);
    expect(p.change[0]).toContain('Change the links to `https://a.test/p`');
    expect(p.verify.command).not.toContain('canonical');
  });

  describe.each(SPELLINGS)('whose URL holds %s', (_name, recorded, written) => {
    it.each(written)('verify finds the stale link written as %s', async (anchor) => {
      const kept = '<a href="/t2">y</a>';
      served = await servedSite({ broken: { '/': `${anchor}${kept}` }, fixed: { '/': kept } });
      const input = linkedSite(served.base, `${served.base}/t2`, [], recorded);
      const p = packetOf(
        'canonical_mismatch',
        detected(detectCanonicalMismatch(input), `${served.base}${recorded}`),
        factsFor(input, SERVED),
      );
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });
});

describe('the canonical_mismatch packet, on what a search engine reads', () => {
  const tag = (href: string) => `<link rel="canonical" href="${href}">`;
  const html = (head: string, body = '') =>
    `<html><head><title>p</title>${head}</head><body>${body}<a href="/">home</a></body></html>`;

  it('asks first whether a canonical on another host is deliberate', () => {
    const p = packetFor(canonicalSite(base, 'cross_host'), base);
    expect(p.change.slice(0, 2)).toEqual([
      'Decide first whether `https://other.test/p` is deliberate: a page republished from another site can name the original as its canonical on purpose. If it is, leave it; this fix does not apply.',
      'Otherwise set the rel="canonical" of `https://a.test/p` to its own URL.',
    ]);
  });

  it('cites Google beside the sentences its page states, and nowhere else', () => {
    const p = packetFor(canonicalSite(base, 'gone_and_linked'), base);
    const cited = [...p.context, ...p.change, ...p.keep].filter((l) => l.includes(GOOGLE));
    expect(cited).toEqual([
      `Write it as one <link rel="canonical"> in the <head>, with an absolute URL. Google accepts the element only in the <head>, and asks for absolute paths (${GOOGLE}).`,
    ]);
  });

  // the round 1 SEO review's inputs
  it.each<[string, string, boolean]>([
    [
      'the old tag commented out above the correct one',
      html(`<!-- ${tag('/t')} -->${tag('/p')}`),
      true,
    ],
    [
      'the page’s head left unclosed',
      `<html><head><title>p</title>${tag('/p')}<body><p>x</p>`,
      true,
    ],
    ['two conflicting canonicals', html(`${tag('/p')}${tag('/t')}`), false],
    ['the tag only in the <body>', html('', tag('/p')), false],
    ['only a commented-out tag', html(`<!-- ${tag('/p')} -->`), false],
  ])('verify, with %s, passes: %s', async (_name, fixedHtml, passes) => {
    served = await servedSite({ broken: { '/p': html(tag('/t')) }, fixed: { '/p': fixedHtml } });
    const p = packetFor(canonicalSite(served.base, 'gone'), served.base);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status === 0).toBe(passes);
    expect(p.verify.expect).toContain('a canonical sent in an HTTP Link header is not read');
  });

  it('on a site that serves its pages with a trailing slash, requests and names the served address', async () => {
    served = await servedSite({
      broken: { '/p/': html(tag('/t/')) },
      fixed: { '/p/': html(tag('/p/')) },
    });
    const u = (path: string) => `${served!.base}${path}`;
    const input = site(
      [
        { path: served.base, links: [u('/t2')], facts: { canonical: { href: null } } },
        { path: u('/p'), facts: { final_url: u('/p/'), canonical: { href: u('/t') } } },
        { path: u('/t2'), facts: { final_url: u('/t2/'), canonical: { href: u('/t2') } } },
        { path: u('/t'), status: 404 },
      ],
      { homepage: served.base },
    );
    const p = packetFor(input, served.base);
    expect(p.change[0]).toBe(`Set the rel="canonical" of \`${u('/p/')}\` to its own URL.`);
    expect(p.verify.command).toContain(` '${u('/p/')}' | `);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('agrees with the engine’s own reading of the pages served', async () => {
    const pages = (canonical: string, links: string[]) => ({
      '/': anchors(links),
      '/p': html(tag(canonical)),
      '/t2': html(tag('/t2')),
    });
    const states = { broken: pages('/t2', ['/p', '/t2']), fixed: pages('/t2', ['/t2']) };
    served = await servedSite(states);
    const read = (state: 'broken' | 'fixed') =>
      site(
        Object.entries(states[state]).map(([path, body]) =>
          pageAsRead(path === '/' ? served!.base : `${served!.base}${path}`, body),
        ),
        { homepage: served!.base },
      );
    const p = packetFor(read('broken'), served.base);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(detectCanonicalMismatch(read('fixed')).filter((r) => r.state === 'detected')).toEqual(
      [],
    );
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
    // a URL, an href the worker stores unresolved, or any text at all
    declared: fc.oneof(hostileUrl('https://b.test'), fc.constantFrom(...NOT_A_URL), hostile()),
    onward: hostileUrl(),
    target: fc.option(fc.constantFrom(...TARGET), { nil: null }),
    linking: fc.uniqueArray(hostileUrl(), { maxLength: 10 }),
    framework: fc.constantFrom(null, 'nextjs' as const),
  });
  type Rec = typeof arb extends fc.Arbitrary<infer T> ? T : never;
  const isUrl = (text: string) => URL.canParse(text) && /^https?:/.test(text);
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
        [
          page,
          pageAt(page, {
            canonical_declared: { href: declared, url: isUrl(declared) ? declared : null },
          }),
        ],
        ...(isUrl(declared)
          ? ([
              [
                declared,
                pageAt(declared, {
                  status_code: target === 'canonical_target_gone' ? 404 : 200,
                  final_url: onward,
                  canonical_declared: { href: onward, url: onward },
                }),
              ],
            ] as const)
          : []),
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
