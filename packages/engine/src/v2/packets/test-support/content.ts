/**
 * What the content packets' tests share: a record built by hand, the engine's own verdict on a page,
 * a page served in two states with the builder's command run against each, and the properties each
 * of the five builders is held to.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FixPacketSchema, PacketFrameworkSchema, type ContentCheck } from '@crawlmouse/types/v2';
import type { ContentDetection, ContentFixType } from '../../content/aggregate.js';
import { CONTENT_CHECKS, type PageVerdict } from '../../content/checks.js';
import { readPage } from '../../content/read.js';
import { CRAWLER_REGISTRY_V2 } from '../../crawler-registry.js';
import { PACKET_BOUNDS } from '../compose.js';
import { userAgentOf } from '../crawler.js';
import { writePacket } from '../registry.js';
import { clean } from '../text.js';
import type { FixPacket, PacketFacts, PacketFramework } from '../types.js';
import { NO_STACK } from './facts.js';
import { hostileText, outsideCodeSpans, UNSHOWN } from './hostile.js';
import {
  inBothStates,
  runCommand,
  twoStateSite,
  type CommandResult,
  type SiteState,
  type TwoStateSite,
} from './verify.js';

export const checkOf = (type: ContentFixType): ContentCheck =>
  (Object.keys(CONTENT_CHECKS) as ContentCheck[]).find((c) => CONTENT_CHECKS[c].fix === type)!;

/** A detected record of `type` on a blog template, as aggregate.ts would report it. */
export function contentRecord(
  type: ContentFixType,
  over: Partial<ContentDetection> = {},
): ContentDetection {
  const check = checkOf(type);
  const affected_urls = over.affected_urls ?? [
    'https://shop.test/blog/a',
    'https://shop.test/blog/b',
  ];
  return {
    type,
    check,
    fingerprint: '0123456789abcdef',
    key: `${CONTENT_CHECKS[check].key}:/blog/{slug}`,
    template_key: '/blog/{slug}',
    state: 'detected',
    reason: null,
    measured: affected_urls.length / 13,
    extent: { failing: affected_urls.length, of: 13, unread: 0 },
    recommendation_class: CONTENT_CHECKS[check].recommendation_class,
    affected_urls,
    ...over,
  };
}

/** The first testable crawler of the registry: the one a command requests as when every crawler is served. */
export const FIRST_TESTABLE = CRAWLER_REGISTRY_V2.find((e) => e.testable)!;
export const FIRST_TESTABLE_UA = userAgentOf(FIRST_TESTABLE);

export function contentFacts(
  served: 'every_crawler' | 'no_crawler' = 'every_crawler',
  framework: PacketFramework | null = null,
): PacketFacts {
  return {
    homepage_url: 'https://shop.test/',
    stack:
      framework === null
        ? NO_STACK
        : {
            ...NO_STACK,
            frontend: {
              name: 'x',
              framework,
              version: null,
              router: null,
              detected_from: 'a test',
            },
          },
    crawlers:
      served === 'no_crawler'
        ? []
        : CRAWLER_REGISTRY_V2.map((e) => ({ ua: e.token, verdict: 'allowed' as const })),
    pages: new Map(),
    edges: [],
    access_tests: [],
  };
}

/** The engine's verdict on one page for the check behind `type`: readPage, then the check's judge. */
export const engineVerdict = (type: ContentFixType, html: string): PageVerdict =>
  CONTENT_CHECKS[checkOf(type)].judge(readPage(html));

/** Every string of a packet a reader is shown, over its own body and its other stacks' bodies. */
export const shownText = (p: FixPacket): string[] =>
  [p, ...p.packets].flatMap((b) => [...b.context, ...b.change, ...b.keep, b.verify.expect]);

const open: TwoStateSite[] = [];

/** Closes each site `commandOn` opened. Call it in `afterEach`. */
export async function closeSites(): Promise<void> {
  await Promise.all(open.splice(0).map((s) => s.close()));
}

export interface TwoStateRun extends Record<SiteState, CommandResult> {
  command: string;
  userAgents: string[];
}

/**
 * Serves `broken` then `fixed` at one URL, has the builder of `type` write its packet for a record
 * whose first failing page is that URL, and runs the packet's command against each state.
 */
export async function commandOn(
  type: ContentFixType,
  pages: Record<SiteState, string>,
  served: 'every_crawler' | 'no_crawler' = 'every_crawler',
): Promise<TwoStateRun> {
  const serve = (html: string) => (_req: unknown, res: { end(body: string): void }) =>
    void res.end(html);
  const site = await twoStateSite({ broken: serve(pages.broken), fixed: serve(pages.fixed) });
  open.push(site);
  const record = contentRecord(type, {
    affected_urls: [`${site.base}/blog/a`, `${site.base}/blog/b`],
  });
  const { command } = writePacket(type, record, contentFacts(served))!.verify;
  return { command, ...(await inBothStates(site, command)), userAgents: site.userAgents() };
}

/**
 * Serves each of `pages` at its own path and runs, for each, the command the builder of `type` writes
 * for a record whose first failing page is that one. The exit status of each, by path.
 */
export async function statusesOn(
  type: ContentFixType,
  pages: Readonly<Record<string, string>>,
): Promise<Record<string, number>> {
  const serve = (req: { url?: string }, res: { end(body: string): void }) =>
    void res.end(pages[req.url ?? ''] ?? 'not found');
  const site = await twoStateSite({ broken: serve, fixed: serve });
  open.push(site);
  const out: Record<string, number> = {};
  for (const path of Object.keys(pages)) {
    const record = contentRecord(type, { affected_urls: [`${site.base}${path}`] });
    const { command } = writePacket(type, record, contentFacts())!.verify;
    out[path] = (await runCommand(command)).status;
  }
  return out;
}

/** A record of `type` with hostile text in each field a crawled site chooses. */
export const hostileRecord = (type: ContentFixType): fc.Arbitrary<ContentDetection> =>
  fc
    .record({
      template_key: hostileText(),
      paths: fc.array(fc.tuple(hostileText(3), hostileText(3)), { minLength: 1, maxLength: 9 }),
      of: fc.integer({ min: 0, max: 5000 }),
      unread: fc.integer({ min: 0, max: 40 }),
    })
    .map(({ template_key, paths, of, unread }) => {
      const affected_urls = paths.map(([p, q], i) => {
        try {
          return new URL(`https://a.test/${i}/${p}?${q}`).href;
        } catch {
          return `https://a.test/${i}`;
        }
      });
      return contentRecord(type, {
        template_key,
        key: `x:${template_key}`,
        affected_urls,
        extent: { failing: affected_urls.length, of: affected_urls.length + of, unread },
      });
    });

/** The same record with every crawled string replaced by a plain one: what a calm site would give. */
function calm(r: ContentDetection): ContentDetection {
  return {
    ...r,
    template_key: '/t',
    key: 'x:/t',
    affected_urls: r.affected_urls.map((_, i) => `https://a.test/${i}`),
  };
}

const CUT_NOTE = / \(cut from \d+ characters\)/g;

/** The properties each content builder is held to (D1, D2, D8). */
export function contentPacketProperties(type: ContentFixType): void {
  const framework = fc.constantFrom(null, ...PacketFrameworkSchema.options);
  const served = fc.constantFrom('every_crawler' as const, 'no_crawler' as const);

  describe(`${type}: properties over hostile records`, () => {
    it('gives the same packet, byte for byte, for the same record and facts', () => {
      fc.assert(
        fc.property(hostileRecord(type), framework, served, (r, f, s) => {
          const first = writePacket(type, r, contentFacts(s, f));
          expect(first).not.toBeNull();
          expect(JSON.stringify(first)).toBe(
            JSON.stringify(writePacket(type, structuredClone(r), contentFacts(s, f))),
          );
        }),
      );
    });

    it('gives a packet the contract accepts, with no line or section cut by the packet bounds', () => {
      fc.assert(
        fc.property(hostileRecord(type), framework, served, (r, f, s) => {
          const p = writePacket(type, r, contentFacts(s, f))!;
          expect(FixPacketSchema.safeParse(p).success).toBe(true);
          expect(JSON.stringify(p).length).toBeLessThanOrEqual(PACKET_BOUNDS.packet_chars);
          for (const text of shownText(p)) {
            expect(text).not.toMatch(/line cut from|not shown: a packet section/);
          }
        }),
      );
    });

    it('lets nothing crawled draw nothing, add a line, or change a word outside a code span', () => {
      fc.assert(
        fc.property(hostileRecord(type), framework, served, (r, f, s) => {
          const hostile = writePacket(type, r, contentFacts(s, f))!;
          const plain = writePacket(type, calm(r), contentFacts(s, f))!;
          for (const text of [...shownText(hostile), hostile.verify.command]) {
            expect(UNSHOWN.test(text)).toBe(false);
          }
          // What stands outside the code spans is the same whatever the site put in its record.
          expect(shownText(hostile).map((t) => outsideCodeSpans(t).replace(CUT_NOTE, ''))).toEqual(
            shownText(plain).map((t) => outsideCodeSpans(t)),
          );
        }),
      );
    });

    it('names no URL its record does not hold', () => {
      fc.assert(
        fc.property(hostileRecord(type), framework, (r, f) => {
          const facts = contentFacts('every_crawler', f);
          const p = writePacket(type, r, facts)!;
          // a URL is shown as `code` shows it: cleaned, and cut when long
          const held = r.affected_urls.map(clean);
          for (const text of shownText(p)) {
            for (const [span] of text.matchAll(/`https?:\/\/[^`]*`/g)) {
              const shown = span.slice(1, -1);
              expect(
                held.some(
                  (u) => u === shown || (text.includes('(cut from') && u.startsWith(shown)),
                ),
                span,
              ).toBe(true);
            }
            expect(outsideCodeSpans(text)).not.toMatch(/https?:\/\//);
          }
        }),
      );
    });
  });
}
