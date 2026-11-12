/**
 * What the structure packets' tests share: a site served from paths in two states, hostile crawled
 * text that carries a mark, and the checks every packet over a hostile record is held to.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import fc from 'fast-check';
import { expect } from 'vitest';
import { FixPacketSchema, type FixType, type PageResult } from '@crawlmouse/types/v2';
import { page, type PageSpec } from '../../../../fixtures/v2/detectors/builders.js';
import { canonicalizeUrl } from '../../../url-canonical.js';
import { readPage } from '../../../../../worker/src/reader/read.js';
import type { CrawlerAccess } from '../../access/types.js';
import type { Detection } from '../../detectors/types.js';
import { writePacket } from '../registry.js';
import type { FixPacket, PacketFacts } from '../types.js';
import { hostileText, outsideCodeSpans, UNSHOWN } from './hostile.js';
import { twoStateSite, type TwoStateSite } from './verify.js';

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
  return packet;
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

/** A page's HTML by path (with its query), per state; a path not listed answers 404. */
export type Served = Record<string, string>;

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
 * in a line, or outside a quoted word in the command.
 */
export function expectHostileSafe(packet: FixPacket): void {
  expect(FixPacketSchema.safeParse(packet).success).toBe(true);
  for (const body of [packet, ...packet.packets]) {
    for (const text of [...body.context, ...body.change, ...body.keep, body.verify.expect]) {
      expect(UNSHOWN.test(text), text).toBe(false);
      expect((text.match(/`/g) ?? []).length % 2, text).toBe(0);
      expect(outsideCodeSpans(text), text).not.toContain(MARK);
    }
    const { command } = body.verify;
    expect(UNSHOWN.test(command), command).toBe(false);
    expect(command.startsWith('curl '), command).toBe(true);
    expect(outsideQuotes(command), command).not.toContain(MARK);
    expect(outsideQuotes(command), command).not.toMatch(/\$\(|`/);
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
