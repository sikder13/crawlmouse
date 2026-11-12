/**
 * What the structure packets' tests share: a site served from paths in two states, hostile crawled
 * text that carries a mark, and the checks every packet over a hostile record is held to.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import fc from 'fast-check';
import { expect } from 'vitest';
import { FixPacketSchema, type FixType, type PageResult } from '@crawlmouse/types/v2';
import {
  page,
  simhashAway,
  site,
  type PageSpec,
} from '../../../../fixtures/v2/detectors/builders.js';
import { canonicalizeUrl } from '../../../url-canonical.js';
import { readPage } from '../../../../../worker/src/reader/read.js';
import type { CrawlerAccess } from '../../access/types.js';
import type { Detection, DetectorInput } from '../../detectors/types.js';
import { writePacket } from '../registry.js';
import type { FixPacket, PacketFacts } from '../types.js';
import { hostileText, outsideCodeSpans, UNSHOWN } from './hostile.js';
import { runCommand, twoStateSite, type SiteState, type TwoStateSite } from './verify.js';

type StructureType = Extract<
  FixType,
  | 'orphan_pages'
  | 'deep_pages'
  | 'generic_anchor_text'
  | 'redirect_chain'
  | 'duplicate_pagination'
  | 'canonical_mismatch'
  | 'hreflang_gap'
>;

/** A crawler the site serves, so a verify command requests as it. */
export const SERVED: readonly Pick<CrawlerAccess, 'ua' | 'verdict'>[] = [
  { ua: 'GPTBot', verdict: 'allowed' },
];

/** The packet of a structure record. */
export function packetOf(type: StructureType, record: Detection, facts: PacketFacts): FixPacket {
  const packet = writePacket(type, record, facts);
  if (packet === null) throw new Error(`${type} has no packet builder`);
  expectOwnWords(packet);
  return packet;
}

/** Every string of a packet that is prose: its lines, in every body, and the readable layer's two. */
export function proseOf(packet: FixPacket): string[] {
  return [packet, ...packet.packets].flatMap((body) => [
    ...body.context,
    ...body.change,
    ...body.keep,
    body.verify.expect,
    ...(body.verify.see === null ? [] : [body.verify.see.today, body.verify.see.after]),
  ]);
}

/** The nouns the structure packets count. */
const COUNTED =
  'pages|links|redirects|clicks|texts|tags|values|annotations|hops|lines|items|crawlers|characters|bits|bytes';

/**
 * Each place `text` says 1 of something in the plural, outside its code spans: "1 redirects", and
 * with a word or two between, "1 other pages", "1 more generic links". "1 page links to" is a page
 * that links, and "1 of the 3 carries" one of several: they stay.
 */
export function pluralsAtOne(text: string): string[] {
  const ours = outsideCodeSpans(text).replace(/\b1 page links to\b/g, '');
  return [
    ...(ours.match(/\b1 (?!carries\b)[a-z]+s\b/g) ?? []),
    ...(ours.match(new RegExp(`\\b1 (?:[a-z]+ ){1,2}(?:${COUNTED})\\b`, 'g')) ?? []),
  ];
}

/** An identifier of this repository's: an enum value or a key, in snake case. */
export const IDENTIFIER = /[a-z]+_[a-z_]+/;

/**
 * What every packet these tests build is held to, in the words this repository wrote (a crawled value
 * is in a code span, and a command holds what it needs): no count of one before a plural (owner
 * ruling 2), and no internal identifier (owner ruling 3). Every structure packet a test builds comes
 * through `packetOf`, so the two rules are checked on each of them.
 */
export function expectOwnWords(packet: FixPacket): void {
  for (const text of proseOf(packet)) {
    const ours = outsideCodeSpans(text);
    expect(pluralsAtOne(text), text).toEqual([]);
    expect(ours, text).not.toMatch(IDENTIFIER);
  }
}

/**
 * The readable command's output on the broken site and on the fixed one. The packet must carry the
 * readable layer, the two outputs must differ, and no line of the proof may have been cut.
 */
export async function seen(
  site: TwoStateSite,
  packet: FixPacket,
): Promise<Record<SiteState, string>> {
  const { see, expect: expected } = packet.verify;
  if (see === null) throw new Error('the packet has no readable command');
  for (const text of [expected, see.today, see.after]) expect(text).not.toContain('(line cut');
  expect(see.command.startsWith('curl -sS '), see.command).toBe(true);
  // read in ten seconds: short besides the URLs, the user agent and the texts it looks for
  expect(outsideQuotes(see.command).length, see.command).toBeLessThan(200);
  expect(see.command).not.toMatch(/awk|ARGV/);
  site.use('broken');
  const broken = await runCommand(see.command);
  site.use('fixed');
  const fixed = await runCommand(see.command);
  site.use('broken');
  expect(fixed.stdout).not.toBe(broken.stdout);
  return { broken: broken.stdout, fixed: fixed.stdout };
}

/** The one record in `state` about `subject` among a detector's records. */
export function detected(
  records: readonly Detection[],
  subject: string,
  state: Detection['state'] = 'detected',
): Detection {
  const found = records.filter((r) => r.state === state && r.key.endsWith(`:${subject}`));
  if (found.length !== 1) {
    throw new Error(`expected one ${state} record for ${subject}, found ${found.length}`);
  }
  return found[0]!;
}

/**
 * A page's HTML by path (with its query), per state; a path not listed answers 404, and one whose
 * entry is `movedTo(path)` answers 301 to that path.
 */
export type Served = Record<string, string>;

const MOVED = '301 to ';
export const movedTo = (path: string): string => `${MOVED}${path}`;

/**
 * The round 2 SEO review's input: a homepage whose request ends at /en/ (as a bare host's ends at
 * www). The crawl files what it read there under the homepage's URL, and a command that reads the
 * homepage must request /en/, since it follows no redirect.
 */
export const HOME_AT_EN = { '/': movedTo('/en/') } as const;

/** `url` with a slash at the end of its path. */
const slashed = (url: string): string => url.replace(/^([^?]*[^/?])(\?.*)?$/, '$1/$2');

/**
 * A path served only with a slash at its end answers a request without it by a 301 to the slashed
 * one, as a site that serves its pages at slashed addresses does.
 */
function serve(pages: Served) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    const body = pages[url];
    if (body?.startsWith(MOVED)) {
      res.writeHead(301, { location: body.slice(MOVED.length) }).end('moved');
      return;
    }
    if (body === undefined && pages[slashed(url)] !== undefined) {
      res.writeHead(301, { location: slashed(url) }).end('moved');
      return;
    }
    res.statusCode = body === undefined ? 404 : 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(body ?? 'not found');
  };
}

/** A site that serves `broken` until it is told to serve `fixed`. */
export const servedSite = (states: { broken: Served; fixed: Served }): Promise<TwoStateSite> =>
  twoStateSite({ broken: serve(states.broken), fixed: serve(states.fixed) });

/**
 * A crawled page as the engine's own reader (the worker's `readPage`) reads `html` served at `url`:
 * its links with their texts, its declared canonical and its hreflang annotations. A test that builds
 * its record from this and runs the packet's command over the same HTML holds the two to one reading.
 */
export function pageAsRead(url: string, html: string, over: Partial<PageSpec> = {}): PageSpec {
  const { read } = readPage({ body: html, bodyCut: false, finalUrl: url });
  if (read === null) throw new Error('the reader did not read the page');
  const declared = read.links.declaredCanonical.canonical;
  const canonical = declared === null ? null : (declared.url ?? declared.href);
  const seen = new Set<string>();
  return {
    path: url,
    links: read.links.links
      .filter((l) => !seen.has(l.toUrl) && seen.add(l.toUrl))
      .map((l) => ({ to: l.toUrl, anchor: l.anchorText, generic: l.isGenericAnchor })),
    ...over,
    facts: {
      canonical: { href: canonical === null ? null : spelledAsEngine(canonical) },
      hreflang: read.links.hreflang.links.map((l) => ({
        lang: l.hreflang,
        href: spelledAsEngine(l.href),
      })),
      simhash: read.simhash,
      ...over.facts,
    },
  };
}

function spelledAsEngine(url: string): string {
  try {
    return canonicalizeUrl(url);
  } catch {
    return url;
  }
}

/** Anchors to `targets`, each with its text, as a page body. */
export const anchors = (targets: readonly (string | [href: string, text: string])[]): string =>
  `<html><body>${targets
    .map((t) => (typeof t === 'string' ? [t, `About ${t}`] : t))
    .map(([href, text]) => `<a href="${href}">${text}</a>`)
    .join('\n')}</body></html>`;

/** A mark every hostile string starts with: text of ours never holds it. */
export const MARK = 'PWNED7';

/** Text a crawled site could choose, starting with `MARK`. */
export const hostile = (maxParts = 3): fc.Arbitrary<string> =>
  hostileText(maxParts).map((t) => `${MARK}${t}`);

/**
 * A URL on `origin` whose path and query are hostile; half of them also hold the characters curl
 * reads as a range or a set of URLs.
 */
export const hostileUrl = (origin = 'https://a.test'): fc.Arbitrary<string> =>
  fc
    .tuple(hostile(), hostile(), fc.constantFrom('', '/p[1-3]/{a,b}'))
    .map(([path, query, glob]) => {
      try {
        return new URL(`${origin}${glob}/${path}?q=${query}`).href;
      } catch {
        return `${origin}${glob}/${MARK}`;
      }
    });

/** Canonical hrefs the worker stores unresolved, as `{ href, url: null }`: none is an http or https URL. */
export const NOT_A_URL = ['http://', '//', 'http://[', 'https://exa mple.com/x'] as const;

/** A crawled page at `url`, read at its own URL, with `over` in place of the defaults. */
export const pageAt = (url: string, over: Partial<PageResult> = {}): PageResult => ({
  ...page({ path: '/placeholder' }),
  url,
  final_url: url,
  ...over,
});

/** A command with its single-quoted words removed: what is left is this repository's. */
const outsideQuotes = (command: string): string =>
  command.replaceAll("'\\''", '').replace(/'[^']*'/g, '');

/**
 * What a packet written from a hostile record is held to: the contract accepts it; no string in it
 * holds a line break or a character that draws nothing; nothing crawled stands outside a code span
 * in a line, or outside a quoted word in a command. The readable layer (`verify.see`) is held to the
 * same: its command, and its two lines.
 */
export function expectHostileSafe(packet: FixPacket): void {
  expect(FixPacketSchema.safeParse(packet).success).toBe(true);
  for (const body of [packet, ...packet.packets]) {
    for (const text of [...body.context, ...body.change, ...body.keep, body.verify.expect]) {
      expect(UNSHOWN.test(text), text).toBe(false);
      expect((text.match(/`/g) ?? []).length % 2, text).toBe(0);
      expect(outsideCodeSpans(text), text).not.toContain(MARK);
    }
    const { see } = body.verify;
    if (see === null) throw new Error('the packet has no readable command');
    for (const text of [see.today, see.after]) {
      expect(UNSHOWN.test(text), text).toBe(false);
      expect((text.match(/`/g) ?? []).length % 2, text).toBe(0);
      expect(outsideCodeSpans(text), text).not.toContain(MARK);
    }
    for (const command of [body.verify.command, see.command]) {
      expect(command).not.toMatch(/[\r\n]/);
      expect(UNSHOWN.test(command), command).toBe(false);
      expect(command.startsWith('curl '), command).toBe(true);
      expect(outsideQuotes(command), command).not.toContain(MARK);
      expect(outsideQuotes(command), command).not.toMatch(/\$\(|`/);
    }
  }
}

/** The same record and facts give the same packet, byte for byte, built twice from nothing shared. */
export function expectDeterministic(
  type: StructureType,
  record: Detection,
  facts: PacketFacts,
): void {
  // a copy of the facts with its own pages and links, so nothing a builder remembered for `facts`
  // (structure.ts `filed`) is read for the second packet
  const fresh: PacketFacts = { ...facts, pages: new Map(facts.pages), edges: [...facts.edges] };
  expect(JSON.stringify(packetOf(type, structuredClone(record), fresh))).toBe(
    JSON.stringify(packetOf(type, record, facts)),
  );
}

/**
 * URLs a record can hold whose links a page can spell in more than one way: the path as the engine
 * records it, and the `<a>` elements that link to it. A command that reads a page for a link to such
 * a URL must find every one of them (the round 1 security review's inputs, and their neighbours).
 */
export const SPELLINGS: [name: string, recorded: string, written: string[]][] = [
  [
    'an apostrophe',
    "/women's",
    [
      `<a href="/women's">x</a>`,
      `<a href="/women&#39;s">x</a>`,
      `<a href='/women&apos;s'>x</a>`,
      `<a href="/women%27s">x</a>`,
    ],
  ],
  ['a backtick', '/old?q=a%60b', ['<a href="/old?q=a`b">x</a>', '<a href="/old?q=a%60b">x</a>']],
  [
    'a letter outside ASCII',
    '/caf%C3%A9',
    ['<a href="/café">x</a>', '<a href="/caf%C3%A9">x</a>', '<a href="/caf%c3%a9">x</a>'],
  ],
  ['a space', '/my%20page', ['<a href="/my page">x</a>', '<a href="/my%20page">x</a>']],
  ['a quote', '/say%22hi%22', [`<a href='/say"hi"'>x</a>`, '<a href="/say&quot;hi&quot;">x</a>']],
];

/**
 * Sites whose detected records are as large as a crawl can make them, with URLs made by `u` on
 * `origin`: an orphan and a deep page; a hub of thirty generic links with long texts; a redirect
 * chain and a canonical on a redirect, each linked from ten pages; a list whose second page names
 * the first as canonical and repeats it; an hreflang cluster of fourteen pages whose first names
 * none of the others back, under twelve invalid values, and names twelve alternates that are gone.
 */
export function largestSites(origin: string, u: (name: string) => string): DetectorInput[] {
  const home = { homepage: origin };
  const hash = '0123456789abcdef';
  const members = Array.from({ length: 14 }, (_, i) => u(`m${i}`));
  const gone = Array.from({ length: 12 }, (_, i) => u(`gone${i}`));
  const linkers = Array.from({ length: 10 }, (_, i) => u(`l${i}`));
  const list = u('list').slice(0, -8);
  /** `site`, with a short text on each link: the fixture's own names the target, which is long here. */
  const siteOf = (pages: PageSpec[]): DetectorInput =>
    site(
      pages.map((p) => ({
        ...p,
        links: p.links?.map((l) => (typeof l === 'string' ? { to: l, anchor: 'a link' } : l)),
      })),
      home,
    );
  return [
    siteOf([
      { path: origin, links: [u('a')] },
      { path: u('a'), links: [u('b')] },
      { path: u('b'), links: [u('c')] },
      { path: u('c'), links: [u('d')] },
      { path: u('d'), links: [origin] },
      { path: u('orphan') },
    ]),
    siteOf([
      {
        path: u('hub'),
        pr: 0.9,
        links: Array.from({ length: 30 }, (_, i) => ({
          to: u(`t${i}`),
          anchor: `${"click 'here' ".repeat(15)}${i}`,
          generic: true,
        })),
      },
      { path: origin, pr: 0.01, links: [u('hub')] },
      ...Array.from({ length: 30 }, (_, i): PageSpec => ({ path: u(`t${i}`), pr: 0.01 })),
    ]),
    siteOf([
      { path: origin, links: linkers },
      ...linkers.map((l): PageSpec => ({ path: l, links: [u('old'), u('p')] })),
      { path: u('old'), facts: { final_url: u('new'), redirect: { hops: 4, loop: false } } },
      { path: u('p'), facts: { canonical: { href: u('t') } } },
      { path: u('t'), facts: { final_url: u('t2'), canonical: { href: u('t2') } } },
      { path: u('t2'), facts: { canonical: { href: u('t2') } } },
    ]),
    siteOf([
      { path: origin, links: [list] },
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
    ]),
    siteOf([
      { path: origin, links: members },
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
    ]),
  ];
}

/** Every string of a packet: its prose in every body, and its two commands. */
export const stringsOf = (packet: FixPacket): string[] => [
  ...proseOf(packet),
  packet.verify.command,
  ...(packet.verify.see === null ? [] : [packet.verify.see.command]),
];
