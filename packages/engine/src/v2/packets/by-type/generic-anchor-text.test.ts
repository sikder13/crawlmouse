import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { edge, site } from '../../../../fixtures/v2/detectors/builders.js';
import { detectGenericAnchors } from '../../detectors/generic-anchors.js';
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

/** A hub with six links, four of them generic; the other pages link back to it. */
const hubSite = (base: string): DetectorInput =>
  site(
    [
      {
        path: `${base}/hub`,
        pr: 0.9,
        links: [
          { to: `${base}/p/1`, anchor: 'Click here', generic: true },
          { to: `${base}/p/2`, anchor: 'Read more', generic: true },
          { to: `${base}/p/3`, anchor: 'click here', generic: true },
          { to: `${base}/p/4`, anchor: 'here', generic: true },
          { to: `${base}/p/5`, anchor: 'Ridge tent' },
          { to: base, anchor: 'Home' },
        ],
      },
      { path: base, pr: 0.01, links: [`${base}/hub`] },
      ...[1, 2, 3, 4, 5].map((n) => ({ path: `${base}/p/${n}`, pr: 0.01, links: [`${base}/hub`] })),
    ],
    { homepage: base },
  );

function titled(input: DetectorInput, url: string, text: string): PacketFacts {
  const facts = factsFor(input, SERVED);
  const pages = new Map(facts.pages);
  pages.set(url, { ...pages.get(url)!, title: { text, chars: text.length, cut: false } });
  return { ...facts, pages };
}

describe('the generic_anchor_text packet', () => {
  const base = 'https://a.test';
  const input = hubSite(base);
  const record = detected(detectGenericAnchors(input), `${base}/hub`);
  const facts = titled(input, `${base}/p/1`, 'Ridge footprint');

  it('says the page is a hub and how many of its recorded links are generic', () => {
    expect(packetOf('generic_anchor_text', record, facts).context).toEqual([
      '`https://a.test/hub` is a hub, one of the top 5% of crawled pages by internal PageRank, and 4 of its 6 recorded links have generic text.',
      'The crawl records one link for each target, with the first link text it found.',
    ]);
  });

  it('lists each generic link with its target, and the target’s title where one was read', () => {
    const p = packetOf('generic_anchor_text', record, facts);
    expect(p.change).toEqual([
      'Replace the text of each of these links with words that name the page it leads to.',
      '`Click here` to `https://a.test/p/1`, whose title is `Ridge footprint`.',
      '`Read more` to `https://a.test/p/2`.',
      '`click here` to `https://a.test/p/3`.',
      '`here` to `https://a.test/p/4`.',
      'Another stock phrase ("read more" in place of "click here") is still generic: name the destination.',
    ]);
    expect(p.keep).toEqual([
      "Keep each link's target and its place on the page: only the text changes.",
    ]);
    expect(p.frameworks).toEqual(['generic']);
  });

  it('lists eight links and counts the rest', () => {
    const many = site(
      [
        {
          path: `${base}/hub`,
          pr: 0.9,
          links: Array.from({ length: 11 }, (_, i) => ({
            to: `${base}/p/${String(i).padStart(2, '0')}`,
            anchor: 'more info',
            generic: true,
          })),
        },
        { path: base, pr: 0.01, links: [`${base}/hub`] },
        ...Array.from({ length: 11 }, (_, i) => ({
          path: `${base}/p/${String(i).padStart(2, '0')}`,
          pr: 0.01,
        })),
      ],
      { homepage: base },
    );
    const p = packetOf(
      'generic_anchor_text',
      detected(detectGenericAnchors(many), `${base}/hub`),
      factsFor(many, SERVED),
    );
    expect(p.change).toHaveLength(11);
    expect(p.change.at(-2)).toBe('3 more generic links on this page are not listed here.');
  });

  it('checks for the recorded texts, each once whatever its case', () => {
    const p = packetOf('generic_anchor_text', record, facts);
    expect(p.verify.command).toMatch(/ARGC = 1 \} [^']*' 'Click here' 'Read more' 'here'$/);
    expect(p.verify.expect).toBe(
      'Exit status 0 once `https://a.test/hub` has link text and none of it is `Click here`, `Read more`, `here`, compared without case, with spaces collapsed and the tags inside a link removed. Today the crawl recorded 4 such links.',
    );
  });

  it('verify fails while a recorded generic text is on the hub and passes once none is', async () => {
    const hub = (texts: string[]) => ({
      '/hub': anchors(texts.map((t, i): [string, string] => [`/p/${i + 1}`, t])),
    });
    served = await servedSite({
      broken: hub(['Click here', 'Read more', 'click here', 'here', 'Ridge tent']),
      fixed: hub(['Ridge footprint', 'Tent care guide', 'Alpine stove', 'Trail mug', 'Ridge tent']),
    });
    const live = hubSite(served.base);
    const p = packetOf(
      'generic_anchor_text',
      detected(detectGenericAnchors(live), `${served.base}/hub`),
      factsFor(live, SERVED),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it.each([
    [
      'one generic link left, in capitals and inside a span',
      '<a href="/p/1"><span>READ   MORE</span></a><a href="/p/2">Ridge tent</a>',
    ],
    ['the links removed', '<p>No links.</p>'],
  ])('verify is not passed by %s', async (_name, html) => {
    served = await servedSite({ broken: { '/hub': html }, fixed: { '/hub': html } });
    const live = hubSite(served.base);
    const p = packetOf(
      'generic_anchor_text',
      detected(detectGenericAnchors(live), `${served.base}/hub`),
      factsFor(live, SERVED),
    );
    expect((await inBothStates(served, p.verify.command)).fixed.status).not.toBe(0);
  });
});

describe('the generic_anchor_text packet over hostile records (properties)', () => {
  const arb = fc.record({
    hub: hostileUrl(),
    links: fc.array(
      fc.record({ to: hostileUrl(), text: hostile(), title: fc.option(hostile(), { nil: null }) }),
      {
        minLength: 1,
        maxLength: 12,
      },
    ),
  });
  type Rec = typeof arb extends fc.Arbitrary<infer T> ? T : never;
  const build = ({ hub, links }: Rec) => {
    const targets = [...new Map(links.map((l) => [l.to, l])).values()].filter((l) => l.to !== hub);
    const record = {
      ...detected(detectGenericAnchors(hubSite('https://a.test')), 'https://a.test/hub'),
    };
    record.key = `anchors:${hub}`;
    record.affected_urls = [hub];
    record.measured = targets.length === 0 ? null : 1;
    record.evidence = {
      pages: [hub],
      edges: targets.map((l) => ({ from_url: hub, to_url: l.to })),
    };
    const facts: PacketFacts = {
      ...factsFor(hubSite('https://a.test'), SERVED),
      pages: new Map([
        [hub, pageAt(hub)],
        ...targets.map((l): [string, ReturnType<typeof pageAt>] => [
          l.to,
          pageAt(l.to, {
            title: l.title === null ? null : { text: l.title, chars: l.title.length, cut: false },
          }),
        ]),
      ]),
      edges: targets.map((l) => ({
        ...edge(hub, l.to),
        anchor_text: l.text,
        is_generic_anchor: true,
      })),
    };
    return { record, facts, linked: targets.length };
  };

  it('lets nothing crawled out of a code span or a quoted word, and adds no line', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts, linked } = build(r);
        fc.pre(linked > 0);
        expectHostileSafe(packetOf('generic_anchor_text', record, facts));
      }),
    );
  });

  it('gives the same packet for the same record and facts', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts, linked } = build(r);
        fc.pre(linked > 0);
        expectDeterministic('generic_anchor_text', record, facts);
      }),
    );
  });

  it('refuses a record whose links the check does not hold, rather than write a command that checks nothing', () => {
    const { record, facts } = build({
      hub: 'https://a.test/hub',
      links: [{ to: 'https://a.test/x', text: 'here', title: null }],
    });
    expect(() => packetOf('generic_anchor_text', record, { ...facts, edges: [] })).toThrow(
      /names no link text the check holds/,
    );
  });
});
