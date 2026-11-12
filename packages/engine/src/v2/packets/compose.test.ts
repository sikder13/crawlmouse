import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FixPacketSchema, PacketFrameworkSchema } from '@crawlmouse/types/v2';
import { simhashAway, site, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { MAX_URL_LENGTH } from '../batch-bounds.js';
import { detectStructure } from '../detectors/index.js';
import type { DetectorInput } from '../detectors/types.js';
import { compose, PACKET_BOUNDS } from './compose.js';
import { COMMAND_BOUNDS } from './html-checks.js';
import { writePacket } from './registry.js';
import { sh, url, word } from './shell.js';
import { code, count, line, type Line } from './text.js';
import { hostileText, outsideCodeSpans, UNSHOWN } from './test-support/hostile.js';
import { factsFor, NO_STACK } from './test-support/facts.js';
import { SERVED } from './test-support/structure.js';
import type { PacketBuilder, PacketFacts, PacketFramework } from './types.js';

/** A record as hostile as a crawled site can make one: every string in it is the site's. */
interface Rec {
  url: string;
  template: string;
  anchors: string[];
}

const facts = (framework: PacketFramework | null = null): PacketFacts => ({
  homepage_url: 'https://a.test',
  stack:
    framework === null
      ? NO_STACK
      : {
          ...NO_STACK,
          frontend: { name: 'x', framework, version: null, router: null, detected_from: 'a test' },
        },
  crawlers: [],
  pages: new Map(),
  edges: [],
  access_tests: [],
});

const builder: PacketBuilder<Rec> = {
  kind: 'builder',
  context: (r) => [
    line`${code(r.template)} serves ${count(r.anchors.length)} links with generic text.`,
  ],
  generic: (r) => ({
    change: r.anchors.map((a) => line`Replace the link text ${code(a)} on ${code(r.url)}.`),
    keep: [line`Keep each link's target.`],
  }),
  stacks: {
    nextjs: {
      write: (r) => ({ change: [line`Edit the Link in ${code(r.template)}.`], keep: [] }),
      sources: [],
    },
    wordpress: {
      write: (r) => (r.anchors.length > 1 ? null : { change: [line`x`], keep: [] }),
      sources: [],
    },
  },
  verify: (r) => ({
    command: sh`curl -sS ${url(r.url)} | grep -q ${word('<a')}`,
    expect: line`Exit status 0.`,
    ua: null,
  }),
};

const rec: Rec = { url: 'https://a.test/hub', template: '/hub', anchors: ['click here', 'more'] };

describe('compose', () => {
  it('writes the generic body first when no front end was detected, and lists only the bodies written', () => {
    const p = compose(builder, rec, facts());
    expect(p.framework).toBe('generic');
    expect(p.frameworks).toEqual(['generic', 'nextjs']);
    expect(p.packets.map((b) => b.framework)).toEqual(['nextjs']);
    expect(p.change).toEqual([
      'Replace the link text `click here` on `https://a.test/hub`.',
      'Replace the link text `more` on `https://a.test/hub`.',
    ]);
  });

  it('writes the detected front end’s body first when the builder has one', () => {
    const p = compose(builder, rec, facts('nextjs'));
    expect(p.framework).toBe('nextjs');
    expect(p.frameworks).toEqual(['nextjs', 'generic']);
    expect(p.change).toEqual(['Edit the Link in `/hub`.']);
    expect(p.packets[0]!.change).toHaveLength(2);
  });

  it('falls back to the generic body when the detected front end has none', () => {
    expect(compose(builder, rec, facts('webflow')).framework).toBe('generic');
    // wordpress declines this record (its writer returns null), so it is not listed either
    const p = compose(builder, rec, facts('wordpress'));
    expect(p.framework).toBe('generic');
    expect(p.frameworks).not.toContain('wordpress');
  });

  it('writes the body of the framework the CMS is, when no front end was detected', () => {
    const wp: PacketFacts = {
      ...facts(),
      stack: { ...NO_STACK, backend: { cms: 'wordpress', detected_from: 'a test' } },
    };
    expect(compose(builder, { ...rec, anchors: ['more'] }, wp).framework).toBe('wordpress');
    const shopify: PacketFacts = {
      ...facts(),
      stack: { ...NO_STACK, backend: { cms: 'shopify', detected_from: 'a test' } },
    };
    expect(compose(builder, rec, shopify).framework).toBe('generic');
  });

  it('shares the context and the verify block between the bodies', () => {
    const p = compose(builder, rec, facts());
    expect(p.packets[0]!.context).toEqual(p.context);
    expect(p.packets[0]!.verify).toEqual(p.verify);
    expect(p.verify.command).toBe("curl -sS 'https://a.test/hub' | grep -q '<a'");
  });

  it('keeps a section to its bound and counts the lines it left out', () => {
    const many = { ...rec, anchors: Array.from({ length: 15 }, (_, i) => `a${i}`) };
    const { change } = compose(builder, many, facts());
    expect(change).toHaveLength(PACKET_BOUNDS.section_lines + 1);
    expect(change.at(-1)).toBe('3 more lines are not shown: a packet section holds 12.');
  });

  it('cuts a line at its bound, closes the code span it cut, and says how long it was', () => {
    const long: PacketBuilder<Rec> = {
      ...builder,
      context: () => [
        line`${code('a'.repeat(190))} ${code('b'.repeat(190))} ${code('c'.repeat(190))} ${code('d'.repeat(190))}`,
      ],
    };
    const [text] = compose(long, rec, facts()).context;
    expect(text).toMatch(/`d+` \(line cut from 771 characters\)$/);
    expect((text!.match(/`/g) ?? []).length % 2).toBe(0);
  });

  it('leaves the other stacks out of a packet past its size bound, and says so', () => {
    const wide = (n: number): Line[] =>
      Array.from(
        { length: n },
        () => line`${code('w'.repeat(190))} ${code('w'.repeat(190))} ${code('w'.repeat(190))}`,
      );
    const big: PacketBuilder<Rec> = {
      ...builder,
      generic: () => ({ change: wide(12), keep: wide(12) }),
      stacks: Object.fromEntries(
        (['nextjs', 'wordpress', 'webflow', 'shopify_liquid'] as const).map((f) => [
          f,
          { write: () => ({ change: wide(12), keep: wide(12) }), sources: [] },
        ]),
      ),
    };
    const p = compose(big, rec, facts());
    expect(p.frameworks).toEqual(['generic']);
    expect(p.packets).toEqual([]);
    expect(p.context.at(-1)).toMatch(
      /^This packet passed 40000 characters \(\d+\), so its 4 rewrites for other stacks are left out\.$/,
    );
    expect(JSON.stringify(p).length).toBeLessThanOrEqual(PACKET_BOUNDS.packet_chars);
  });

  it('refuses a body with no change', () => {
    const empty: PacketBuilder<Rec> = { ...builder, generic: () => ({ change: [], keep: [] }) };
    expect(() => compose(empty, rec, facts())).toThrow(/no context or no change/);
  });
});

describe('compose over hostile records (properties)', () => {
  const hostileRec: fc.Arbitrary<Rec> = fc.record({
    url: fc.tuple(hostileText(3), hostileText(3)).map(([p, q]) => {
      try {
        return new URL(`https://a.test/${p}?${q}`).href;
      } catch {
        return 'https://a.test/';
      }
    }),
    template: hostileText(),
    anchors: fc.array(hostileText(), { minLength: 1, maxLength: 20 }),
  });
  const framework = fc.constantFrom(null, ...PacketFrameworkSchema.options);

  it('gives the same packet, byte for byte, for the same record and facts', () => {
    fc.assert(
      fc.property(hostileRec, framework, (r, f) => {
        expect(JSON.stringify(compose(builder, r, facts(f)))).toBe(
          JSON.stringify(compose(builder, structuredClone(r), facts(f))),
        );
      }),
    );
  });

  it('gives a packet the contract accepts, inside its size bound, listing a framework only with its body', () => {
    fc.assert(
      fc.property(hostileRec, framework, (r, f) => {
        const p = compose(builder, r, facts(f));
        expect(FixPacketSchema.safeParse(p).success).toBe(true);
        expect(JSON.stringify(p).length).toBeLessThanOrEqual(PACKET_BOUNDS.packet_chars);
        expect([...p.frameworks].sort()).toEqual(
          [p.framework, ...p.packets.map((b) => b.framework)].sort(),
        );
      }),
    );
  });

  it('lets nothing crawled add a line, draw nothing, or stand outside a code span', () => {
    const ours = new Set(
      [
        ' serves N links with generic text.',
        'Replace the link text  on .',
        "Keep each link's target.",
        'Edit the Link in .',
        'x',
        'Exit status 0.',
      ].map((s) => s.trim()),
    );
    fc.assert(
      fc.property(hostileRec, framework, (r, f) => {
        const p = compose(builder, r, facts(f));
        for (const body of [p, ...p.packets]) {
          for (const text of [...body.context, ...body.change, ...body.keep, body.verify.expect]) {
            expect(UNSHOWN.test(text)).toBe(false);
            const written = outsideCodeSpans(text)
              .replace(/ \((line )?cut from \d+ characters\)/g, '')
              .replace(/\d+ links/, 'N links')
              .trim();
            if (/more lines? (is|are) not shown/.test(written)) continue;
            expect(ours.has(written), written).toBe(true);
          }
          expect(UNSHOWN.test(body.verify.command)).toBe(false);
        }
      }),
    );
  });
});

const base = 'https://a.test';

/** `site`, with a short text on each link: the fixture's own names the target, which is long here. */
const siteOf = (pages: PageSpec[], options: { homepage: string }): DetectorInput =>
  site(
    pages.map((p) => ({
      ...p,
      links: p.links?.map((l) => (typeof l === 'string' ? { to: l, anchor: 'a link' } : l)),
    })),
    options,
  );

/** Sites whose detected records are as large as a crawl can make them, with URLs made by `u`. */
function sites(u: (name: string) => string): DetectorInput[] {
  const home = { homepage: base };
  const hash = '0123456789abcdef';
  const members = Array.from({ length: 14 }, (_, i) => u(`m${i}`));
  const gone = Array.from({ length: 12 }, (_, i) => u(`gone${i}`));
  const linkers = Array.from({ length: 10 }, (_, i) => u(`l${i}`));
  const list = `${u('list').slice(0, MAX_URL_LENGTH - 8)}`;
  return [
    // an orphan, which is a deep page too; and a deep page at the end of a chain
    siteOf(
      [
        { path: base, links: [u('a')] },
        { path: u('a'), links: [u('b')] },
        { path: u('b'), links: [u('c')] },
        { path: u('c'), links: [u('d')] },
        { path: u('d'), links: [base] },
        { path: u('orphan') },
      ],
      home,
    ),
    // a hub of generic links
    siteOf(
      [
        {
          path: u('hub'),
          pr: 0.9,
          links: Array.from({ length: 30 }, (_, i) => ({
            to: u(`t${i}`),
            anchor: `${"click 'here' ".repeat(15)}${i}`,
            generic: true,
          })),
        },
        { path: base, pr: 0.01, links: [u('hub')] },
        ...Array.from({ length: 30 }, (_, i): PageSpec => ({ path: u(`t${i}`), pr: 0.01 })),
      ],
      home,
    ),
    // a redirect chain many pages link to, and a canonical on a redirect that pages link under
    siteOf(
      [
        { path: base, links: linkers },
        ...linkers.map((l): PageSpec => ({ path: l, links: [u('old'), u('p')] })),
        { path: u('old'), facts: { final_url: u('new'), redirect: { hops: 4, loop: false } } },
        { path: u('p'), facts: { canonical: { href: u('t') } } },
        { path: u('t'), facts: { final_url: u('t2'), canonical: { href: u('t2') } } },
        { path: u('t2'), facts: { canonical: { href: u('t2') } } },
      ],
      home,
    ),
    // a list whose page 2 names page 1 as canonical and repeats it
    siteOf(
      [
        { path: base, links: [list] },
        {
          path: list,
          links: [`${list}?page=2`],
          facts: { simhash: hash, canonical: { href: list } },
        },
        {
          path: `${list}?page=2`,
          template: '/list/{slug}',
          kind: 'pagination',
          facts: { simhash: simhashAway(hash, 1), canonical: { href: list } },
        },
      ],
      home,
    ),
    // an hreflang cluster whose first page names none of the others back, under invalid codes,
    // and names alternates that are gone
    siteOf(
      [
        { path: base, links: members },
        ...members.map(
          (m, i): PageSpec => ({
            path: m,
            facts: {
              hreflang:
                i === 0
                  ? [
                      ...gone.map((href, j) => ({ lang: `not-a-code-${j}`, href })),
                      { lang: 'en', href: u('elsewhere') },
                    ]
                  : members.map((href, j) => ({ lang: `l${j}`, href })),
            },
          }),
        ),
        ...gone.map((g): PageSpec => ({ path: g, status: 404 })),
      ],
      home,
    ),
  ];
}

/** A URL of `length` characters whose path repeats `fill`. */
const urlOf =
  (length: number, fill: string) =>
  (name: string): string =>
    `${base}/${name}/${fill.repeat(length)}`.slice(0, length);

describe('the size of a structure packet (security review, finding 5)', () => {
  const fills = ['a', "'", '%C3%A9', '[1-3]', '`', '"'];
  const stacks = [
    NO_STACK,
    {
      ...NO_STACK,
      frontend: {
        name: 'x',
        framework: 'nextjs' as const,
        version: null,
        router: null,
        detected_from: 'a test',
      },
    },
  ];

  /** Five URLs, each character of one written as three, and the programs and the list around them. */
  const COMMAND_MAX = 5 * 3 * MAX_URL_LENGTH + COMMAND_BOUNDS.listed_chars;

  it('stays under the stated bound for URLs of the worker’s longest and the largest records', () => {
    const seen = new Map<string, number>();
    // each combination once: a random draw of them can miss the one that passes packet_chars
    for (const length of [64, 512, MAX_URL_LENGTH]) {
      for (const fill of fills) {
        for (const stack of stacks) {
          for (const input of sites(urlOf(length, fill))) {
            const facts = factsFor(input, SERVED, stack);
            for (const record of detectStructure(input)) {
              if (record.state !== 'detected') continue;
              const packet = writePacket(record.type, record, facts);
              const size = JSON.stringify(packet).length;
              seen.set(record.type, Math.max(seen.get(record.type) ?? 0, size));
              expect(size, record.type).toBeLessThanOrEqual(PACKET_BOUNDS.one_body_chars);
              if (record.type === 'hreflang_gap' && length === MAX_URL_LENGTH) {
                // the URLs and values of this cluster do not fit a command at this length: it says so
                expect(packet!.verify.expect).toMatch(
                  / Of the \d+ URLs and values that follow, the command leaves \d+ out: /,
                );
              }
              // more than one body only under packet_chars; one body can be past it
              if (packet!.packets.length > 0) {
                expect(size, record.type).toBeLessThanOrEqual(PACKET_BOUNDS.packet_chars);
              }
              expect(packet!.verify.command.length, record.type).toBeLessThanOrEqual(COMMAND_MAX);
            }
          }
        }
      }
    }
    // a packet of one body does pass packet_chars: the bound on it is one_body_chars, and no less
    expect(Math.max(...seen.values())).toBeGreaterThan(PACKET_BOUNDS.packet_chars);
    expect([...seen.keys()].sort()).toEqual([
      'canonical_mismatch',
      'deep_pages',
      'duplicate_pagination',
      'generic_anchor_text',
      'hreflang_gap',
      'orphan_pages',
      'redirect_chain',
    ]);
  });
});
