import type { IncomingMessage, ServerResponse } from 'node:http';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { site } from '../../../../fixtures/v2/detectors/builders.js';
import { detectRedirectChains } from '../../detectors/redirect-chains.js';
import type { DetectorInput } from '../../detectors/types.js';
import { factsFor } from '../test-support/facts.js';
import {
  anchors,
  detected,
  expectDeterministic,
  expectHostileSafe,
  hostileUrl,
  packetOf,
  pageAsRead,
  pageAt,
  SERVED,
  servedSite,
  SPELLINGS,
} from '../test-support/structure.js';
import { inBothStates, twoStateSite, type TwoStateSite } from '../test-support/verify.js';
import type { PacketFacts } from '../types.js';

let served: TwoStateSite | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

/** Two pages link to /old, which answers at /new after two redirects. */
const chainSite = (base: string): DetectorInput =>
  site(
    [
      { path: base, links: [`${base}/old`, `${base}/guide`] },
      { path: `${base}/guide`, links: [`${base}/old`, base] },
      {
        path: `${base}/old`,
        facts: { final_url: `${base}/new/`, redirect: { hops: 2, loop: false } },
      },
    ],
    { homepage: base },
  );

/** One page links to /loop, whose redirects come back round. */
const loopSite = (base: string): DetectorInput =>
  site(
    [
      { path: base, links: [`${base}/loop`] },
      { path: `${base}/loop`, status: 301, facts: { redirect: { hops: 3, loop: true } } },
    ],
    { homepage: base },
  );

describe('the redirect_chain packet', () => {
  const base = 'https://a.test';

  describe('a chain that ends at a page', () => {
    const input = chainSite(base);
    const record = detected(detectRedirectChains(input), `${base}/old`);
    const p = packetOf('redirect_chain', record, factsFor(input, SERVED));

    it('gives the linking pages, each hop as recorded, and where the chain ends', () => {
      expect(p.context).toEqual([
        '2 pages link to `https://a.test/old`, which answers only after 2 redirects.',
        'Redirect 1: `https://a.test/old` answers 301 with Location `https://a.test/new/`.',
        'Redirect 2: `https://a.test/old` answers 301 with Location `https://a.test/new/`.',
        'The chain ends at `https://a.test/new/`, which answers 200.',
      ]);
    });

    it('points the links at the final URL and keeps the redirect', () => {
      expect(p.change).toEqual([
        'On `https://a.test`, `https://a.test/guide`, change the href of each link to `https://a.test/old` so that it reads `https://a.test/new/`.',
        'A link in a shared header, footer or template is one edit for every page it appears on.',
        'Separately, if you control the redirect rules, send `https://a.test/old` to `https://a.test/new/` in one response. The links are what this fix measures.',
      ]);
      expect(p.keep).toEqual([
        'Keep the redirect from `https://a.test/old`: links on other sites and bookmarks still arrive there.',
      ]);
      expect(p.frameworks).toEqual(['generic']);
    });

    it('checks the first linking page, and says there are more', () => {
      expect(p.verify.command).toMatch(/^curl -sS -A '[^']*' 'https:\/\/a\.test\/' \| /);
      expect(p.verify.command).toMatch(
        /' 'https:\/\/a\.test' '1' 'https:\/\/a\.test\/old' 'https:\/\/a\.test\/new\/'$/,
      );
      expect(p.verify.expect).toBe(
        'Exit status 0 once `https://a.test` links to `https://a.test/new/` and no longer to `https://a.test/old` (an <a> href in full or from the root). Today it links to `https://a.test/old`. The command reads the first of the 2 linking pages: run it for each.',
      );
    });
  });

  describe('a chain with nowhere to point the links', () => {
    const input = loopSite(base);
    const record = detected(detectRedirectChains(input), `${base}/loop`);
    const p = packetOf('redirect_chain', record, factsFor(input, SERVED));

    it('says the redirects loop, from the condition the record proves', () => {
      expect(record.conditions).toEqual(['redirect_loop']);
      expect(p.context[0]).toBe(
        '1 page links to `https://a.test/loop`, whose redirects loop: after 3 redirects a Location names a URL the chain had already requested.',
      );
      expect(p.context.at(-1)).toBe('The chain reaches no page.');
    });

    it('asks for the redirect rules to be fixed, names no final URL, and checks the redirects', () => {
      expect(p.change).toEqual([
        'Fix the redirect rules so that a request for `https://a.test/loop` reaches a page that answers 200 through at most one redirect.',
        'Or, where the page the links should lead to is known, point the links on `https://a.test` straight at it.',
      ]);
      expect(p.verify.command).toMatch(
        /^curl -sS -f -o \/dev\/null -L --max-redirs 1 -A '[^']*' 'https:\/\/a\.test\/loop'$/,
      );
    });
  });

  it('verify fails while the linking page links to the redirecting URL and passes once it links to the final one', async () => {
    const pages = (home: string[]) => ({ '/': anchors(home), '/guide': anchors(['/old', '/']) });
    served = await servedSite({
      broken: pages(['/old', '/guide']),
      fixed: pages(['/new/', '/guide']),
    });
    const live = chainSite(served.base);
    const p = packetOf(
      'redirect_chain',
      detected(detectRedirectChains(live), `${served.base}/old`),
      factsFor(live, SERVED),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it.each([
    ['the link removed, with no link to the final URL', ['/guide']],
    ['a link to the final URL added beside the old one', ['/old', '/new', '/guide']],
  ])('verify is not passed by %s', async (_name, home) => {
    const pages = { '/': anchors(home) };
    served = await servedSite({ broken: pages, fixed: pages });
    const live = chainSite(served.base);
    const p = packetOf(
      'redirect_chain',
      detected(detectRedirectChains(live), `${served.base}/old`),
      factsFor(live, SERVED),
    );
    expect((await inBothStates(served, p.verify.command)).fixed.status).not.toBe(0);
  });

  it('verify, for a loop, fails while the URL takes more than one redirect and passes once it takes one', async () => {
    served = await twoStateSite({
      broken: redirecting({ '/loop': '/loop-2', '/loop-2': '/loop-3', '/loop-3': '/loop' }),
      fixed: redirecting({ '/loop': '/landed' }),
    });
    const live = loopSite(served.base);
    const p = packetOf(
      'redirect_chain',
      detected(detectRedirectChains(live), `${served.base}/loop`),
      factsFor(live, SERVED),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  const redirecting =
    (hops: Record<string, string>) => (req: IncomingMessage, res: ServerResponse) => {
      const to = hops[req.url ?? ''];
      if (to === undefined) return void res.end('<html><body>a page</body></html>');
      res.writeHead(301, { location: to });
      res.end();
    };

  describe('a chain that ends at the same page, at the address its server serves', () => {
    /** /x answers at /x/ after two redirects: the engine spells both addresses as one page. */
    const slashSite = (b: string): DetectorInput =>
      site(
        [
          { path: b, links: [`${b}/x`] },
          { path: `${b}/x`, facts: { final_url: `${b}/x/`, redirect: { hops: 2, loop: false } } },
        ],
        { homepage: b },
      );
    const input = slashSite(base);
    const p = packetOf(
      'redirect_chain',
      detected(detectRedirectChains(input), `${base}/x`),
      factsFor(input, SERVED),
    );

    it('says where the chain ended, and does not say the crawl reached no page', () => {
      expect(p.context[0]).toBe(
        '1 page links to `https://a.test/x`, which answers only after 2 redirects.',
      );
      expect(p.context.at(-1)).toBe(
        'The chain ends at `https://a.test/x/`, which answers 200: the same page, at the address its server serves it at.',
      );
      expect(p.change[0]).toBe(
        'On `https://a.test`, write the href of each link to this page as `https://a.test/x/`, character for character (scheme, host and the slash at its end), so that it needs no redirect.',
      );
      expect(p.verify.expect).toBe(
        'Exit status 0 once `https://a.test/x`, the address the crawl requested, reaches a page that answers below 400 through at most one redirect. Today the crawl recorded 2 redirects before `https://a.test/x/` answered. The command follows the redirects; links rewritten to `https://a.test/x/` are measured on the next check.',
      );
      expect([...p.context, p.verify.expect].join(' ')).not.toMatch(/no page/);
    });

    it('verify requests the address the crawl requested, and fails until it takes one redirect', async () => {
      served = await twoStateSite({
        broken: redirecting({ '/x': '/x-moved', '/x-moved': '/x/' }),
        fixed: redirecting({ '/x': '/x/' }),
      });
      const live = slashSite(served.base);
      const q = packetOf(
        'redirect_chain',
        detected(detectRedirectChains(live), `${served.base}/x`),
        factsFor(live, SERVED),
      );
      expect(q.verify.command.endsWith(` '${served.base}/x'`)).toBe(true);
      const { broken, fixed } = await inBothStates(served, q.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });

  it('says a chain the crawl stopped on was still redirecting, not that it answers', () => {
    const input = site(
      [
        { path: base, links: [`${base}/stuck`] },
        { path: `${base}/stuck`, status: 301, facts: { redirect: { hops: 5, loop: false } } },
      ],
      { homepage: base },
    );
    const p = packetOf(
      'redirect_chain',
      detected(detectRedirectChains(input), `${base}/stuck`),
      factsFor(input, SERVED),
    );
    expect(p.context[0]).toBe(
      '1 page links to `https://a.test/stuck`, which was still redirecting after 5 redirects.',
    );
    expect(p.context.at(-1)).toBe('The crawl reached no page: its request ended with status 301.');
  });

  /** The home page links to `target`, which answers at /new/ after two redirects. */
  const chainTo = (b: string, target: string, linker = b): DetectorInput =>
    site(
      [
        { path: b, links: linker === b ? [`${b}${target}`] : [linker] },
        ...(linker === b
          ? []
          : [{ path: linker, links: [`${b}${target}`], facts: { final_url: `${linker}/` } }]),
        {
          path: `${b}${target}`,
          facts: { final_url: `${b}/new/`, redirect: { hops: 2, loop: false } },
        },
      ],
      { homepage: b },
    );

  // the round 1 security review's inputs: the page spells the stale URL another way than the record
  describe.each(SPELLINGS)('a redirecting URL that holds %s', (_name, recorded, written) => {
    it.each(written)('verify finds the stale link written as %s', async (anchor) => {
      const kept = '<a href="/new/">y</a>';
      served = await servedSite({ broken: { '/': `${anchor}${kept}` }, fixed: { '/': kept } });
      const live = chainTo(served.base, recorded);
      const p = packetOf(
        'redirect_chain',
        detected(detectRedirectChains(live), `${served.base}${recorded}`),
        factsFor(live, SERVED),
      );
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });

  it('on a site that serves its pages with a trailing slash, requests the linking page as served', async () => {
    served = await servedSite({
      broken: { '/guide/': anchors(['/old']) },
      fixed: { '/guide/': anchors(['/new']) },
    });
    const live = chainTo(served.base, '/old', `${served.base}/guide`);
    const p = packetOf(
      'redirect_chain',
      detected(detectRedirectChains(live), `${served.base}/old`),
      factsFor(live, SERVED),
    );
    expect(p.verify.command).toContain(` '${served.base}/guide/' | `);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('agrees with the engine’s own reading of the pages served', async () => {
    const states = {
      broken: { '/': `<a href="/old">old</a><!-- <a href="/new/">new</a> -->` },
      fixed: { '/': `<!-- <a href="/old">old</a> --><a href='/new/'>new</a>` },
    };
    served = await servedSite(states);
    const b = served.base;
    const read = (state: 'broken' | 'fixed') =>
      site(
        [
          pageAsRead(b, states[state]['/']),
          {
            path: `${b}/old`,
            facts: { final_url: `${b}/new/`, redirect: { hops: 2, loop: false } },
          },
          { path: `${b}/new` },
        ],
        { homepage: b },
      );
    const p = packetOf(
      'redirect_chain',
      detected(detectRedirectChains(read('broken')), `${b}/old`),
      factsFor(read('broken'), SERVED),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(detectRedirectChains(read('fixed')).filter((r) => r.state === 'detected')).toEqual([]);
  });
});

describe('the redirect_chain packet over hostile records (properties)', () => {
  const arb = fc.record({
    target: hostileUrl(),
    final: fc.option(hostileUrl(), { nil: null }),
    via: hostileUrl(),
    linking: fc.uniqueArray(hostileUrl(), { minLength: 1, maxLength: 10 }),
    loop: fc.boolean(),
  });
  type Rec = typeof arb extends fc.Arbitrary<infer T> ? T : never;
  const build = ({ target, final, via, linking, loop }: Rec) => {
    const record = {
      ...detected(detectRedirectChains(chainSite('https://a.test')), 'https://a.test/old'),
    };
    record.key = `redirect:${target}`;
    record.conditions = loop ? ['redirect_loop'] : [];
    record.affected_urls = [...linking].sort();
    record.evidence = {
      pages: [target],
      edges: record.affected_urls.map((from_url) => ({ from_url, to_url: target })),
    };
    const facts: PacketFacts = {
      ...factsFor(chainSite('https://a.test'), SERVED),
      pages: new Map([
        [
          target,
          pageAt(target, {
            final_url: final,
            redirect: {
              hops: [
                { from: target, status: 301, location: via },
                { from: via, status: 302, location: final },
              ],
              loop,
            },
          }),
        ],
      ]),
    };
    return { record, facts };
  };

  it('lets nothing crawled out of a code span or a quoted word, and adds no line', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectHostileSafe(packetOf('redirect_chain', record, facts));
      }),
    );
  });

  it('gives the same packet for the same record and facts', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectDeterministic('redirect_chain', record, facts);
      }),
    );
  });
});
