import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { edge, site } from '../../../../fixtures/v2/detectors/builders.js';
import { detectDeepPages } from '../../detectors/deep-pages.js';
import { detectOrphans } from '../../detectors/orphans.js';
import type { DetectorInput } from '../../detectors/types.js';
import { shallowParent } from '../../grade/effects.js';
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
} from '../test-support/structure.js';
import { inBothStates, type TwoStateSite } from '../test-support/verify.js';
import type { PacketFacts } from '../types.js';

let served: TwoStateSite | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

/** home → /a → /b and /c → /d → /deep: the last is five clicks down, /b and /c are two. */
const chain = (base: string): DetectorInput =>
  site(
    [
      { path: base, links: [`${base}/a`] },
      { path: `${base}/a`, links: [`${base}/c`, `${base}/b`] },
      { path: `${base}/b`, links: [base] },
      { path: `${base}/c`, links: [`${base}/d`] },
      { path: `${base}/d`, links: [`${base}/e`] },
      { path: `${base}/e`, links: [`${base}/deep`] },
      { path: `${base}/deep`, links: [base] },
    ],
    { homepage: base },
  );

describe('the deep_pages packet', () => {
  const base = 'https://a.test';
  const input = chain(base);
  const facts = factsFor(input, SERVED);
  const record = detected(detectDeepPages(input), `${base}/deep`);

  it('gives the measured depth, the limit, and the pages on the path found', () => {
    expect(packetOf('deep_pages', record, facts).context).toEqual([
      '`https://a.test/deep` is 5 clicks from the homepage `https://a.test`; the audit counts more than 3 as deep.',
      'The shortest path the crawl found passes through, in URL order: `https://a.test/a`, `https://a.test/c`, `https://a.test/d`, `https://a.test/e`.',
    ]);
  });

  it('names the page the estimate links it from: the one grade/effects.ts chooses', () => {
    const parent = shallowParent({ ...input, edges: input.edges });
    expect(parent).toBe('https://a.test/b');
    const p = packetOf('deep_pages', record, facts);
    expect(p.change).toEqual([
      'Add a link to `https://a.test/deep` on a page at most 2 clicks from the homepage, so that it lands within 3.',
      'On the links as crawled, the estimate for this fix puts the link on `https://a.test/b`, a page that close. Another page as close does as well: pick the one a visitor would look on.',
      'Write the link as an <a> element with an href, in the HTML the server sends. A link that only JavaScript adds is not there for a crawler that does not run scripts.',
    ]);
    expect(p.verify.command).toMatch(/^curl -sS -A '[^']*' 'https:\/\/a\.test\/b' \| /);
    expect(p.frameworks).toEqual(['generic']);
  });

  it('says no path reaches a page the crawl could not reach by links', () => {
    const cut = site(
      [
        { path: base, links: [`${base}/a`] },
        { path: `${base}/a`, links: [base] },
        { path: `${base}/deep`, links: [base] },
      ],
      { homepage: base },
    );
    const unreachable = detected(detectDeepPages(cut), `${base}/deep`);
    expect(unreachable.measured).toBeNull();
    expect(packetOf('deep_pages', unreachable, factsFor(cut, SERVED)).context).toEqual([
      'No path of links from the homepage `https://a.test` reaches `https://a.test/deep`; the audit counts more than 3 clicks as deep.',
    ]);
  });

  it('writes no command that passes today: a parent that already links to the page is refused', () => {
    const linked: PacketFacts = {
      ...facts,
      edges: [...facts.edges, edge(`${base}/b`, `${base}/deep`)],
    };
    expect(packetOf('deep_pages', record, facts).verify.expect).toContain('today it holds none');
    expect(() => packetOf('deep_pages', record, linked)).toThrow(/already links to the page/);
  });

  describe('a page that is also an orphan', () => {
    /** home → /a → /b → /c; nothing links to /deep, and /island is out of reach too. */
    const cut = site(
      [
        { path: base, links: [`${base}/a`] },
        { path: `${base}/a`, links: [`${base}/b`] },
        { path: `${base}/b`, links: [`${base}/c`] },
        { path: `${base}/c`, links: [base] },
        { path: `${base}/island`, links: [base] },
        { path: `${base}/deep`, links: [base] },
      ],
      { homepage: base },
    );
    const unreachable = detected(detectDeepPages(cut), `${base}/deep`);
    const suggesting = (parent: string): PacketFacts => {
      const all = factsFor(cut, SERVED);
      const pages = new Map(all.pages);
      pages.set(`${base}/deep`, {
        ...pages.get(`${base}/deep`)!,
        is_orphan: true,
        suggested_parent_url: `${base}${parent}`,
      });
      return { ...all, pages };
    };

    it('names the parent the orphan fix suggests when it is close enough, so the two fixes ask for one link', () => {
      const withParent = suggesting('/a');
      const deep = packetOf('deep_pages', unreachable, withParent);
      expect(deep.change[1]).toBe(
        "No other page links to this one, and the audit's fix for that suggests `https://a.test/a`, a page that close: one link there settles both. The estimate for this fix was computed with the link on `https://a.test/b`; any page as close does as well.",
      );
      const orphan = packetOf(
        'orphan_pages',
        detected(detectOrphans(cut), `${base}/deep`),
        withParent,
      );
      expect(orphan.change[0]).toContain('on `https://a.test/a`.');
      expect(deep.verify.command).toBe(orphan.verify.command);
    });

    it.each(['/c', '/island'])(
      'keeps the estimate’s page when the suggested parent %s is too far, and says so',
      (parent) => {
        const deep = packetOf('deep_pages', unreachable, suggesting(parent));
        expect(deep.change.slice(1, 3)).toEqual([
          'On the links as crawled, the estimate for this fix puts the link on `https://a.test/b`, a page that close. Another page as close does as well: pick the one a visitor would look on.',
          `No other page links to this one, and the audit's fix for that suggests \`https://a.test${parent}\`, which is not that close to the homepage: a link there alone leaves the page deep, and a link on \`https://a.test/b\` settles both.`,
        ]);
        expect(deep.verify.command).toContain(" 'https://a.test/b' | ");
      },
    );
  });

  it.each([
    ['a comment', '<!-- <a href="/deep">Deep</a> -->'],
    ['a script string', `<script>var nav='<a href="/deep">Deep</a>'</script>`],
  ])('is not passed by a link written inside %s', async (_name, inert) => {
    served = await servedSite({
      broken: { '/b': `<a href="/">home</a>${inert}` },
      fixed: { '/b': `<a href="/">home</a>${inert}<a href="/deep">Deep</a>` },
    });
    const live = chain(served.base);
    const p = packetOf(
      'deep_pages',
      detected(detectDeepPages(live), `${served.base}/deep`),
      factsFor(live, SERVED),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('verify fails while the shallow page does not link to the deep one and passes once it does', async () => {
    const pages = (b: string[]) => ({
      '/': anchors(['/a']),
      '/a': anchors(['/c', '/b']),
      '/b': anchors(b),
      '/c': anchors(['/d']),
      '/d': anchors(['/e']),
      '/e': anchors(['/deep']),
      '/deep': anchors(['/']),
    });
    served = await servedSite({ broken: pages(['/']), fixed: pages(['/', '/deep']) });
    const live = chain(served.base);
    const p = packetOf(
      'deep_pages',
      detected(detectDeepPages(live), `${served.base}/deep`),
      factsFor(live, SERVED),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  /** The chain's pages as HTML; `b` is what /b links to. With `slash`, every page is served at a slashed address. */
  const chainHtml = (b: string[], slash = '') =>
    Object.fromEntries(
      Object.entries({
        '/': ['/a'],
        '/a': ['/c', '/b'],
        '/b': b,
        '/c': ['/d'],
        '/d': ['/e'],
        '/e': ['/deep'],
        '/deep': ['/'],
      }).map(([path, links]) => [
        path === '/' ? path : `${path}${slash}`,
        anchors(links.map((l) => (l === '/' ? l : `${l}${slash}`))),
      ]),
    );

  it('on a site that serves its pages with a trailing slash, requests and names the served addresses', async () => {
    served = await servedSite({
      broken: chainHtml(['/'], '/'),
      fixed: chainHtml(['/', '/deep'], '/'),
    });
    const u = (path: string) => `${served!.base}${path}`;
    const live = site(
      chain(served.base).pages.map((p) => ({
        path: p.url,
        links: chain(served!.base)
          .edges.filter((e) => e.from_url === p.url)
          .map((e) => e.to_url),
        facts: { final_url: p.url === served!.base ? p.url : `${p.url}/` },
      })),
      { homepage: served.base },
    );
    const p = packetOf(
      'deep_pages',
      detected(detectDeepPages(live), u('/deep')),
      factsFor(live, SERVED),
    );
    expect(p.change[0]).toContain(`Add a link to \`${u('/deep/')}\` on a page`);
    expect(p.verify.command).toContain(` '${u('/b/')}' | `);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('agrees with the engine’s own reading of the pages served', async () => {
    const states = { broken: chainHtml(['/']), fixed: chainHtml(['/', '/deep']) };
    served = await servedSite(states);
    const read = (state: 'broken' | 'fixed') =>
      site(
        Object.entries(states[state]).map(([path, body]) =>
          pageAsRead(path === '/' ? served!.base : `${served!.base}${path}`, body),
        ),
        { homepage: served!.base },
      );
    const url = `${served.base}/deep`;
    const p = packetOf(
      'deep_pages',
      detected(detectDeepPages(read('broken')), url),
      factsFor(read('broken'), SERVED),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(detected(detectDeepPages(read('fixed')), url, 'not_detected').measured).toBe(3);
  });
});

describe('the deep_pages packet over hostile records (properties)', () => {
  const arb = fc.record({ home: hostileUrl(), mid: hostileUrl(), deep: hostileUrl() });
  const build = ({ home, mid, deep }: { home: string; mid: string; deep: string }) => {
    const record = { ...detected(detectDeepPages(chain('https://a.test')), 'https://a.test/deep') };
    record.key = `depth:${deep}`;
    record.affected_urls = [deep];
    record.evidence = { pages: [deep, mid, home].sort(), edges: [] };
    const facts: PacketFacts = {
      ...factsFor(chain('https://a.test'), SERVED),
      homepage_url: home,
      pages: new Map([home, mid, deep].map((u) => [u, pageAt(u)])),
      edges: [edge(home, mid)],
    };
    return { record, facts };
  };

  it('lets nothing crawled out of a code span or a quoted word, and adds no line', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectHostileSafe(packetOf('deep_pages', record, facts));
      }),
    );
  });

  it('gives the same packet for the same record and facts', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectDeterministic('deep_pages', record, facts);
      }),
    );
  });
});
