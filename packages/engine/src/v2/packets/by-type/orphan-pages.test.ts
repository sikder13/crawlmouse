import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { site } from '../../../../fixtures/v2/detectors/builders.js';
import { detectOrphans } from '../../detectors/orphans.js';
import type { DetectorInput } from '../../detectors/types.js';
import { factsFor } from '../test-support/facts.js';
import {
  anchors,
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

/** A home page linking to a hub, and a lantern page nothing links to. */
const orphanSite = (base: string): DetectorInput =>
  site(
    [
      { path: base, links: [`${base}/hub`] },
      { path: `${base}/hub`, links: [base] },
      { path: `${base}/products/lantern` },
    ],
    { homepage: base },
  );

function withParent(input: DetectorInput, orphan: string, parent: string | null): PacketFacts {
  const facts = factsFor(input, SERVED);
  const pages = new Map(facts.pages);
  pages.set(orphan, {
    ...pages.get(orphan)!,
    suggested_parent_url: parent,
    title: { text: 'Forgotten lantern', chars: 17, cut: false },
  });
  return { ...facts, pages };
}

describe('the orphan_pages packet', () => {
  const base = 'https://a.test';
  const input = orphanSite(base);
  const orphan = `${base}/products/lantern`;
  const record = detected(detectOrphans(input), orphan);

  it('says how many pages the crawl read and that none links to the page', () => {
    const p = packetOf('orphan_pages', record, withParent(input, orphan, `${base}/hub`));
    expect(p.context).toEqual([
      '`https://a.test/products/lantern` has no link from another page: the crawl read 2 other pages that answered 200, and none links to it.',
    ]);
  });

  it('names the suggested parent, the link as markup, and the title as a starting point', () => {
    const p = packetOf('orphan_pages', record, withParent(input, orphan, `${base}/hub`));
    expect(p.change).toEqual([
      'Add a link to `https://a.test/products/lantern` on `https://a.test/hub`. The audit suggests that page: of the pages that do not link here yet, its title, link text and URL are the closest match.',
      'Write the link as an <a> element with an href, in the HTML the server sends. A link that only JavaScript adds is not there for a crawler that does not run scripts.',
      'Give it link text that names the page. Its title, as a starting point: `Forgotten lantern`.',
    ]);
    expect(p.keep).toEqual([
      'Keep the page at `https://a.test/products/lantern`: the fix is a link to it, not a move or a redirect.',
    ]);
    expect(p.frameworks).toEqual(['generic']);
  });

  it('says the audit suggests no parent when it has none, and names no page', () => {
    const p = packetOf('orphan_pages', record, withParent(input, orphan, null));
    expect(p.change[0]).toBe(
      'Add a link to `https://a.test/products/lantern` on a page a visitor would reach it from: the listing page of its section, or a page on the same subject. The audit suggests no page for it.',
    );
    expect(p.change.join(' ')).not.toContain('https://a.test/hub');
    expect(p.verify.command).toContain("'https://a.test/'");
    expect(p.verify.expect).toContain('put the URL of the page you added the link to in its place');
  });

  it('requests the suggested parent as a crawler the site serves', () => {
    const p = packetOf('orphan_pages', record, withParent(input, orphan, `${base}/hub`));
    expect(p.verify.ua).toBe('GPTBot');
    expect(p.verify.command).toMatch(
      /^curl -sS -A '[^']*GPTBot[^']*' 'https:\/\/a\.test\/hub' \| /,
    );
    expect(p.verify.command).toMatch(
      / \| grep -qxF -e 'https:\/\/a\.test\/products\/lantern' -e '\/products\/lantern'$/,
    );
    const none = packetOf('orphan_pages', record, {
      ...withParent(input, orphan, `${base}/hub`),
      crawlers: [],
    });
    expect(none.verify.ua).toBeNull();
    expect(none.verify.command).toMatch(/^curl -sS 'https:\/\/a\.test\/hub' \| /);
  });

  describe.each([
    ['the suggested parent', '/hub', '/hub'],
    ['the homepage, when no parent is suggested', null, '/'],
  ])('verify, on %s', (_name, parentPath, linkedFrom) => {
    it('fails while the page links nowhere to the orphan and passes once it does', async () => {
      const lantern = '/products/lantern';
      const pages = { '/': anchors(['/hub']), '/hub': anchors(['/']), [lantern]: anchors([]) };
      served = await servedSite({
        broken: pages,
        fixed: { ...pages, [linkedFrom]: anchors(['/hub', '/', lantern]) },
      });
      const live = orphanSite(served.base);
      const url = `${served.base}${lantern}`;
      const p = packetOf(
        'orphan_pages',
        detected(detectOrphans(live), url),
        withParent(live, url, parentPath === null ? null : `${served.base}${parentPath}`),
      );
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
      expect(served.userAgents().every((ua) => ua.includes('GPTBot'))).toBe(true);
    });
  });

  it('is not passed by a link to another page whose URL starts the same', async () => {
    const pages = { '/hub': anchors(['/products/lantern-oil', '/products']) };
    served = await servedSite({ broken: pages, fixed: pages });
    const live = orphanSite(served.base);
    const url = `${served.base}/products/lantern`;
    const p = packetOf(
      'orphan_pages',
      detected(detectOrphans(live), url),
      withParent(live, url, `${served.base}/hub`),
    );
    expect((await inBothStates(served, p.verify.command)).fixed.status).not.toBe(0);
  });
});

describe('the orphan_pages packet over hostile records (properties)', () => {
  const arb = fc.record({
    orphan: hostileUrl(),
    parent: fc.option(hostileUrl(), { nil: null }),
    title: fc.option(hostile(), { nil: null }),
  });
  const build = ({
    orphan,
    parent,
    title,
  }: {
    orphan: string;
    parent: string | null;
    title: string | null;
  }) => {
    const record = {
      ...detected(detectOrphans(orphanSite('https://a.test')), 'https://a.test/products/lantern'),
    };
    record.key = `orphan:${orphan}`;
    record.affected_urls = [orphan];
    const facts: PacketFacts = {
      ...factsFor(orphanSite('https://a.test'), SERVED),
      pages: new Map([
        [
          orphan,
          pageAt(orphan, {
            suggested_parent_url: parent,
            title: title === null ? null : { text: title, chars: title.length, cut: false },
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
        expectHostileSafe(packetOf('orphan_pages', record, facts));
      }),
    );
  });

  it('gives the same packet for the same record and facts', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectDeterministic('orphan_pages', record, facts);
      }),
    );
  });
});
