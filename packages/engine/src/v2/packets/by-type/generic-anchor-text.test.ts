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
  pageAsRead,
  pageAt,
  HOME_AT_EN,
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
    expect(p.verify.command).toMatch(/\}' '1' '3' 'Click here' 'Read more' 'here'$/);
    expect(p.verify.expect).toBe(
      'Exit status 0 once `https://a.test/hub` has links and the first link to each target says none of these recorded generic texts: `Click here`, `Read more`, `here`. Case, runs of spaces and tags inside a link are ignored; a text over 8192 bytes counts as generic. A later link to the same target is not read, as in the crawl, and another stock phrase passes: it is judged on the next check. A page that itself prints "crawlmouse:end" does not pass.',
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

  it('takes the singular at one link', () => {
    const one = {
      ...record,
      measured: 1,
      evidence: { ...record.evidence, edges: record.evidence.edges.slice(0, 1) },
    };
    const p = packetOf('generic_anchor_text', one, facts);
    expect(p.context[0]).toContain('and 1 of its 1 recorded link has generic text.');
    expect(p.verify.see?.today).toContain('the crawl recorded 1 generic link on this page.');
    const two = {
      ...record,
      measured: 1,
      evidence: { ...record.evidence, edges: record.evidence.edges.slice(0, 2) },
    };
    expect(packetOf('generic_anchor_text', two, facts).context[0]).toContain(
      'and 2 of its 2 recorded links have generic text.',
    );
  });

  it('shows the links with a command to read, and what it prints today and after', async () => {
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
    expect(p.verify.see).toEqual({
      command: expect.stringMatching(
        /^curl -sS --compressed --max-time 20 -A '[^']*' '[^']*\/hub' \| tr '[^']*' ' {3}' \| grep -aioE '<a \[\^>\]\*>\[\^<\]\*<\/a>' \| grep -iF -e 'Click here' -e 'Read more' -e 'here'$/,
      ),
      today:
        'The links that say `Click here`, `Read more`, `here`: the crawl recorded 4 generic links on this page. A link with a tag inside its text is not printed; the exact check reads it.',
      after: 'Nothing, once no link says one of them.',
    });
    const printed = await seen(served, p);
    expect(printed.broken.trim().split('\n')).toEqual([
      '<a href="/p/1">Click here</a>',
      '<a href="/p/2">Read more</a>',
      '<a href="/p/3">click here</a>',
      '<a href="/p/4">here</a>',
    ]);
    expect(printed.fixed).toBe('');
  });

  // round 3, SEO finding 1: the readable command printed nothing for a link whose text is on the
  // line after its tag, or whose tag is written over several lines
  it('the readable command prints a link whose tag or text is written over several lines', async () => {
    const hub = (texts: string[]) => ({
      '/hub': `<html><body>${texts
        .map((t, i) => `<a class="card"\n href='/p/${i + 1}'>\n  ${t}\n</a>`)
        .join('\n')}</body></html>`,
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
    const printed = await seen(served, p);
    expect(
      printed.broken
        .trim()
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ')),
    ).toEqual([
      `<a class="card" href='/p/1'> Click here </a>`,
      `<a class="card" href='/p/2'> Read more </a>`,
      `<a class="card" href='/p/3'> click here </a>`,
      `<a class="card" href='/p/4'> here </a>`,
    ]);
    expect(printed.fixed).toBe('');
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  // round 3, correctness note (b): a line break written as a reference inside a generic text
  it('verify is not passed by a generic text with its space written as &NewLine; or a tab in its href', async () => {
    const hub = (first: string) => ({
      '/hub': `<html><body>${first}${[2, 3, 4, 5]
        .map((n) => `<a href="/p/${n}">Page ${n}</a>`)
        .join('')}</body></html>`,
    });
    served = await servedSite({
      broken: hub('<a href="/p/\t1">Click&NewLine;here</a>'),
      fixed: hub('<a href="/p/\t1">Ridge footprint</a>'),
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

  // round 2, SEO finding 1: the hub answers at another address than the one the crawl names it by
  it('when the hub is a homepage that answers at /en/, verify requests /en/ in both states', async () => {
    const home = (texts: string[]) => ({
      ...HOME_AT_EN,
      '/en/': anchors(texts.map((t, i): [string, string] => [`/p/${i + 1}`, t])),
    });
    served = await servedSite({
      broken: home(['Click here', 'Read more', 'Ridge tent']),
      fixed: home(['Ridge footprint', 'Tent care guide', 'Ridge tent']),
    });
    const b = served.base;
    const live = site(
      [
        {
          path: b,
          pr: 0.9,
          facts: { final_url: `${b}/en/` },
          links: [
            { to: `${b}/p/1`, anchor: 'Click here', generic: true },
            { to: `${b}/p/2`, anchor: 'Read more', generic: true },
            { to: `${b}/p/3`, anchor: 'Ridge tent' },
            { to: `${b}/p/4`, anchor: 'click here', generic: true },
            { to: `${b}/p/5`, anchor: 'Alpine stove' },
          ],
        },
        ...[1, 2, 3, 4, 5].map((n) => ({ path: `${b}/p/${n}`, pr: 0.01, links: [b] })),
      ],
      { homepage: b },
    );
    const p = packetOf(
      'generic_anchor_text',
      detected(detectGenericAnchors(live), b),
      factsFor(live, SERVED),
    );
    expect(p.verify.command).toContain(` '${b}/en/' | `);
    expect(p.verify.expect).toContain(`once \`${b}/en/\` (where \`${b}\` answers) has links`);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    const printed = await seen(served, p);
    expect(printed.broken).toContain('>Click here</a>');
    expect(printed.fixed).toBe('');
  });

  // round 2: a generic text the page writes another way than the record holds it
  it.each([
    ['a numeric character reference', 'Click here', '&#99;lick here'],
    ['a hex character reference', 'Click here', 'Click&#x20;here'],
    ['a backtick, which a packet shows as an apostrophe', 'tap `here`', 'tap `here`'],
    ['an em space, which the crawl reads as a space', 'Click\u2003here', 'Click\u2003here'],
    ['a comment inside the text', 'Click here', 'Cli<!-- x -->ck here'],
  ])('verify is not passed by a generic text written with %s', async (_name, recorded, written) => {
    const hub = (text: string) => ({
      '/hub': `<a href="/p/1">${text}</a><a href="/p/2">Ridge tent</a>`,
    });
    served = await servedSite({ broken: hub(written), fixed: hub('Ridge footprint') });
    const b = served.base;
    const live = site(
      [
        {
          path: `${b}/hub`,
          pr: 0.9,
          links: [
            ...[1, 3, 4].map((n) => ({ to: `${b}/p/${n}`, anchor: recorded, generic: true })),
            { to: `${b}/p/2`, anchor: 'Ridge tent' },
            { to: `${b}/p/5`, anchor: 'Alpine stove' },
          ],
        },
        { path: b, pr: 0.01, links: [`${b}/hub`] },
        ...[1, 2, 3, 4, 5].map((n) => ({ path: `${b}/p/${n}`, pr: 0.01, links: [`${b}/hub`] })),
      ],
      { homepage: b },
    );
    const p = packetOf(
      'generic_anchor_text',
      detected(detectGenericAnchors(live), `${b}/hub`),
      factsFor(live, SERVED),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('leaves out the links the crawl leaves out: a fragment alone, and another site', async () => {
    const hub = (first: string) => ({
      '/hub': `<a href="/p/1">${first}</a><a href="#">Click here</a><a href="https://other.test/x">Read more</a>`,
    });
    served = await servedSite({ broken: hub('Click here'), fixed: hub('Ridge footprint') });
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

  // the round 1 SEO review's input: the crawl keeps the first text for a target, and so does the command
  it('verify reads the first link to each target, as the record does', async () => {
    const named = ['Ridge footprint', 'Tent care guide', 'Alpine stove', 'Trail mug', 'Ridge tent'];
    const hub = (extra: string) => ({
      '/hub': `${anchors(named.map((t, i): [string, string] => [`/p/${i + 1}`, t]))}${extra}`,
    });
    served = await servedSite({
      broken: hub('<a href="/p/6">Read more</a>'),
      fixed: hub('<a href="/p/1">Read more</a>'),
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

  it('on a site that serves its pages with a trailing slash, requests the hub as served', async () => {
    const hub = (texts: string[]) => ({
      '/hub/': anchors(texts.map((t, i): [string, string] => [`/p/${i + 1}/`, t])),
    });
    served = await servedSite({
      broken: hub(['Click here', 'Ridge tent']),
      fixed: hub(['Ridge footprint', 'Ridge tent']),
    });
    const live = hubSite(served.base);
    const facts = factsFor(live, SERVED);
    const pages = new Map(facts.pages);
    const url = `${served.base}/hub`;
    pages.set(url, { ...pages.get(url)!, final_url: `${url}/` });
    const p = packetOf('generic_anchor_text', detected(detectGenericAnchors(live), url), {
      ...facts,
      pages,
    });
    expect(p.verify.command).toContain(` '${url}/' | `);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('agrees with the engine’s own reading of the pages served', async () => {
    const hub = (texts: string[]) =>
      `<html><body>${texts
        .map((t, i) => `<a href="/p/${i + 1}"><span> ${t} </span></a>`)
        .join('\n')}<!-- <a href="/p/9">Click here</a> --><a href="/">Home</a></body></html>`;
    const states = {
      broken: {
        '/hub': hub(['Click&nbsp;here', 'READ   more', 'click here', 'here', 'Ridge tent']),
      },
      fixed: {
        '/hub': hub(['Ridge footprint', 'Tent care', 'Alpine stove', 'Trail mug', 'Ridge tent']),
      },
    };
    served = await servedSite(states);
    const b = served.base;
    const read = (state: 'broken' | 'fixed') =>
      site(
        [
          pageAsRead(`${b}/hub`, states[state]['/hub'], { pr: 0.9 }),
          { path: b, pr: 0.01, links: [`${b}/hub`] },
          ...[1, 2, 3, 4, 5].map((n) => ({ path: `${b}/p/${n}`, pr: 0.01, links: [`${b}/hub`] })),
        ],
        { homepage: b },
      );
    const record = detected(detectGenericAnchors(read('broken')), `${b}/hub`);
    expect(record.evidence.edges).toHaveLength(4);
    const p = packetOf('generic_anchor_text', record, factsFor(read('broken'), SERVED));
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(detectGenericAnchors(read('fixed')).filter((r) => r.state === 'detected')).toEqual([]);
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
