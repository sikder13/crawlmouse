/**
 * What the structure packets' tests share: a site served from paths in two states, hostile crawled
 * text that carries a mark, and the checks every packet over a hostile record is held to.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import fc from 'fast-check';
import { expect } from 'vitest';
import { FixPacketSchema, type FixType, type PageResult } from '@crawlmouse/types/v2';
import { page } from '../../../../fixtures/v2/detectors/builders.js';
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

/** The one detected record of `type` about `subject` among a detector's records. */
export function detected(records: readonly Detection[], subject: string): Detection {
  const found = records.filter((r) => r.state === 'detected' && r.key.endsWith(`:${subject}`));
  if (found.length !== 1) {
    throw new Error(`expected one detected record for ${subject}, found ${found.length}`);
  }
  return found[0]!;
}

/** A page's HTML by path (with its query), per state; a path not listed answers 404. */
export type Served = Record<string, string>;

function serve(pages: Served) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const body = pages[req.url ?? ''];
    res.statusCode = body === undefined ? 404 : 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(body ?? 'not found');
  };
}

/** A site that serves `broken` until it is told to serve `fixed`. */
export const servedSite = (states: { broken: Served; fixed: Served }): Promise<TwoStateSite> =>
  twoStateSite({ broken: serve(states.broken), fixed: serve(states.fixed) });

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

/** A URL on `origin` whose path and query are hostile. */
export const hostileUrl = (origin = 'https://a.test'): fc.Arbitrary<string> =>
  fc.tuple(hostile(), hostile()).map(([path, query]) => {
    try {
      return new URL(`${origin}/${path}?q=${query}`).href;
    } catch {
      return `${origin}/${MARK}`;
    }
  });

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

/** The same record and facts give the same packet, byte for byte. */
export function expectDeterministic(
  type: StructureType,
  record: Detection,
  facts: PacketFacts,
): void {
  expect(JSON.stringify(packetOf(type, structuredClone(record), facts))).toBe(
    JSON.stringify(packetOf(type, record, facts)),
  );
}
