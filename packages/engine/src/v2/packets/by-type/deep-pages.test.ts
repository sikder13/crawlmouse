import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { edge, site } from '../../../../fixtures/v2/detectors/builders.js';
import { detectDeepPages } from '../../detectors/deep-pages.js';
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

  it('does not say the parent holds no link today when the recorded links show one', () => {
    const linked: PacketFacts = {
      ...facts,
      edges: [...facts.edges, edge(`${base}/b`, `${base}/deep`)],
    };
    expect(packetOf('deep_pages', record, facts).verify.expect).toContain('today it holds none');
    expect(packetOf('deep_pages', record, linked).verify.expect).not.toContain('today');
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
