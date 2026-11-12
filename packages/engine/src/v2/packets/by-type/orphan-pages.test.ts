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
  pageAsRead,
  HOME_AT_EN,
  pageAt,
  seen,
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
      "Add a link to `https://a.test/products/lantern` on `https://a.test/hub`. The audit ranks the content pages on this host that do not link here yet by the words their title, link texts and URL path share with this page's, and suggests the first; on a tie, the lower URL.",
      '`https://a.test/hub` is 1 click from the homepage, so this link also puts the page within 3.',
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
      /^curl -sS -f --compressed --max-time 20 -A '[^']*GPTBot[^']*' -w '[^']*' 'https:\/\/a\.test\/hub' \| /,
    );
    expect(p.verify.command).toMatch(
      / \| LC_ALL=C awk '.*' '0' '1' 'https:\/\/a\.test\/products\/lantern'$/,
    );
    const none = packetOf('orphan_pages', record, {
      ...withParent(input, orphan, `${base}/hub`),
      crawlers: [],
    });
    expect(none.verify.ua).toBeNull();
    expect(none.verify.command).toMatch(
      /^curl -sS -f --compressed --max-time 20 -w '[^']*' 'https:\/\/a\.test\/hub' \| /,
    );
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

  // round 2, SEO finding 1: the page read answers at another address than the one the crawl names it by
  describe.each([
    ['the suggested parent', true],
    ['the homepage, when no parent is suggested', false],
  ])('when the homepage answers at /en/ and is %s', (_name, suggested) => {
    it('verify requests /en/, fails while it holds no link to the orphan and passes once it does', async () => {
      const lantern = '/products/lantern';
      served = await servedSite({
        broken: { ...HOME_AT_EN, '/en/': anchors(['/hub']) },
        fixed: { ...HOME_AT_EN, '/en/': anchors(['/hub', lantern]) },
      });
      const b = served.base;
      const live = site(
        [
          { path: b, links: [`${b}/hub`], facts: { final_url: `${b}/en/` } },
          { path: `${b}/hub`, links: [b] },
          { path: `${b}${lantern}` },
        ],
        { homepage: b },
      );
      const p = packetOf(
        'orphan_pages',
        detected(detectOrphans(live), `${b}${lantern}`),
        withParent(live, `${b}${lantern}`, suggested ? b : null),
      );
      expect(p.verify.command).toContain(` '${b}/en/' | `);
      if (suggested) {
        expect(p.change[0]).toContain(`on \`${b}\`.`);
        expect(p.verify.expect).toContain(`once \`${b}/en/\` (where \`${b}\` answers) holds`);
      }
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
      const printed = await seen(served, p);
      expect(printed.broken).toBe('');
      expect(printed.fixed).toContain(`href="${lantern}"`);
    });
  });

  it('shows the link with a command to read, and what it prints today and after', async () => {
    const lantern = '/products/lantern';
    served = await servedSite({
      broken: { '/hub': anchors(['/']) },
      fixed: { '/hub': anchors(['/', lantern]) },
    });
    const live = orphanSite(served.base);
    const url = `${served.base}${lantern}`;
    const p = packetOf(
      'orphan_pages',
      detected(detectOrphans(live), url),
      withParent(live, url, `${served.base}/hub`),
    );
    expect(p.verify.see).toEqual({
      command: expect.stringMatching(
        /^curl -sS --compressed --max-time 20 -A '[^']*GPTBot[^']*' '[^']*\/hub' \| tr '[^']*' ' {3}' \| grep -aioE '<a \[\^>\]\*>' \| grep -F -e '\/products\/lantern"' .* -e '\/products\/lantern>'$/,
      ),
      today: `Nothing: the crawl found no link to \`${url}\` on any page.`,
      after:
        'The <a> tag you added: a line that holds `/products/lantern`. A link that spells the path another way is not printed; the exact check reads it.',
    });
    const printed = await seen(served, p);
    // today: nothing; after: the tag
    expect(printed.broken).toBe('');
    expect(printed.fixed).toBe(`<a href="${lantern}">\n`);
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

  // round 3, correctness finding 1: the readable command kept a tag by the path alone, so it printed
  // a link to /products/lantern-oil while `today` read "Nothing"
  it('the readable command prints no link to another page whose path starts the same', async () => {
    const other = ['/products/lantern-oil', '/products/lantern-2?x=1', '/products'];
    served = await servedSite({
      broken: { '/hub': anchors(other) },
      fixed: { '/hub': anchors([...other, '/products/lantern?ref=hub']) },
    });
    const live = orphanSite(served.base);
    const url = `${served.base}/products/lantern`;
    const p = packetOf(
      'orphan_pages',
      detected(detectOrphans(live), url),
      withParent(live, url, `${served.base}/hub`),
    );
    expect(p.verify.see?.today).toMatch(/^Nothing: /);
    const printed = await seen(served, p);
    expect(printed.broken).toBe('');
    expect(printed.fixed).toBe('<a href="/products/lantern?ref=hub">\n');
  });

  // round 3, correctness finding 3: "1 other pages" survived the plural property, which could not
  // see a count behind an adjective and built no record with one other page
  it('takes the singular at one other page', () => {
    const two = site([{ path: base }, { path: orphan }], { homepage: base });
    const p = packetOf(
      'orphan_pages',
      detected(detectOrphans(two), orphan),
      withParent(two, orphan, null),
    );
    expect(p.context[0]).toBe(
      '`https://a.test/products/lantern` has no link from another page: the crawl read 1 other page that answered 200, and none links to it.',
    );
  });

  // round 3, security finding 2 (wording): the command requested the homepage and did not name the
  // address, which is another one when the homepage's request ends elsewhere
  it('with no suggested parent, names the address the command requests for the homepage', () => {
    const live = site(
      [
        { path: base, links: [`${base}/hub`], facts: { final_url: `${base}/en/` } },
        { path: `${base}/hub`, links: [base] },
        { path: orphan },
      ],
      { homepage: base },
    );
    const p = packetOf(
      'orphan_pages',
      detected(detectOrphans(live), orphan),
      withParent(live, orphan, null),
    );
    expect(p.verify.command).toContain(" 'https://a.test/en/' | ");
    expect(p.verify.expect).toContain(
      'so the command requests the homepage, `https://a.test/en/` (where `https://a.test` answers): put the URL of the page you added the link to in its place.',
    );
  });

  // round 3, SEO note 3: the step named /hub/ and the line after it /hub, in one packet
  it('names the suggested parent at one address throughout', () => {
    const live = site(
      [
        { path: base, links: [`${base}/hub`] },
        { path: `${base}/hub`, links: [base], facts: { final_url: `${base}/hub/` } },
        { path: orphan },
      ],
      { homepage: base },
    );
    const p = packetOf(
      'orphan_pages',
      detected(detectOrphans(live), orphan),
      withParent(live, orphan, `${base}/hub`),
    );
    expect(p.change[0]).toContain(' on `https://a.test/hub/`. ');
    expect(p.change[1]).toBe(
      '`https://a.test/hub/` is 1 click from the homepage, so this link also puts the page within 3.',
    );
    expect(p.change.join(' ')).not.toContain('`https://a.test/hub`');
  });

  it('says when a link on the suggested parent leaves the page deep', () => {
    const far = site(
      [
        { path: base, links: [`${base}/a`] },
        { path: `${base}/a`, links: [`${base}/b`] },
        { path: `${base}/b`, links: [`${base}/c`] },
        { path: `${base}/c`, links: [base] },
        { path: `${base}/island`, links: [base] },
        { path: orphan },
      ],
      { homepage: base },
    );
    const lantern = detected(detectOrphans(far), orphan);
    const line = (parent: string) =>
      packetOf('orphan_pages', lantern, withParent(far, orphan, `${base}${parent}`)).change[1];
    expect(line('/b')).toBe(
      '`https://a.test/b` is 2 clicks from the homepage, so this link also puts the page within 3.',
    );
    expect(line('/c')).toBe(
      '`https://a.test/c` is 3 clicks from the homepage, so with this link alone the page is more than 3 clicks deep: where the audit lists a deep-page fix for this URL, it names a page close enough for both.',
    );
    expect(line('/island')).toBe(
      'No path of links from the homepage reaches `https://a.test/island` either, so with this link alone the page stays out of reach of the homepage: where the audit lists a deep-page fix for this URL, it names a page close enough for both.',
    );
  });

  // the round 1 correctness review's inputs: the engine reads no link from either
  it.each([
    ['a comment', '<!-- <a href="/products/lantern">Lantern</a> -->'],
    ['a script string', `<script>var nav='<a href="/products/lantern">Lantern</a>'</script>`],
  ])('is not passed by a link written inside %s', async (_name, inert) => {
    const hub = (extra: string) => `<html><body><a href="/">home</a>${extra}</body></html>`;
    served = await servedSite({
      broken: { '/hub': hub(inert) },
      fixed: { '/hub': hub(`${inert}<a href="/products/lantern">Lantern</a>`) },
    });
    const live = orphanSite(served.base);
    const url = `${served.base}/products/lantern`;
    const p = packetOf(
      'orphan_pages',
      detected(detectOrphans(live), url),
      withParent(live, url, `${served.base}/hub`),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('on a site that serves its pages with a trailing slash, requests the parent and names the orphan as served', async () => {
    const hub = (links: string[]) => ({ '/hub/': anchors(links) });
    served = await servedSite({
      broken: hub(['/']),
      fixed: hub(['/', '/products/lantern/']),
    });
    const u = (path: string) => `${served!.base}${path}`;
    const live = site(
      [
        { path: served.base, links: [u('/hub')] },
        { path: u('/hub'), links: [served.base], facts: { final_url: u('/hub/') } },
        { path: u('/products/lantern'), facts: { final_url: u('/products/lantern/') } },
      ],
      { homepage: served.base },
    );
    const url = u('/products/lantern');
    const p = packetOf(
      'orphan_pages',
      detected(detectOrphans(live), url),
      withParent(live, url, u('/hub')),
    );
    expect(p.change[0]).toContain(
      `Add a link to \`${u('/products/lantern/')}\` on \`${u('/hub/')}\`.`,
    );
    expect(p.verify.command).toContain(` '${u('/hub/')}' | `);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('agrees with the engine’s own reading of the pages served', async () => {
    const lantern = '/products/lantern';
    const pages = (hub: string) => ({
      '/': anchors(['/hub']),
      '/hub': hub,
      [lantern]: anchors(['/']),
    });
    const states = {
      broken: pages(`<a href="/">home</a><!-- <a href="${lantern}">Lantern</a> -->`),
      fixed: pages(`<a href="/">home</a><a href='${lantern}/#top'>Lantern</a>`),
    };
    served = await servedSite(states);
    const read = (state: 'broken' | 'fixed') =>
      site(
        Object.entries(states[state]).map(([path, body]) =>
          pageAsRead(path === '/' ? served!.base : `${served!.base}${path}`, body),
        ),
        { homepage: served!.base },
      );
    const url = `${served.base}${lantern}`;
    const p = packetOf(
      'orphan_pages',
      detected(detectOrphans(read('broken')), url),
      withParent(read('broken'), url, `${served.base}/hub`),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(detected(detectOrphans(read('fixed')), url, 'not_detected').state).toBe('not_detected');
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
