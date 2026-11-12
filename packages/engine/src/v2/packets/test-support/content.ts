/**
 * What the content packets' tests share: a record built by hand, the engine's own verdict on a page,
 * a page served in two states with the builder's command run against each, and the properties each
 * of the five builders is held to.
 */
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FixPacketSchema,
  PacketFrameworkSchema,
  type ContentCheck,
  type PageResult,
} from '@crawlmouse/types/v2';
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
import { HOSTILE_FRAGMENTS, hostileText, outsideCodeSpans, UNSHOWN } from './hostile.js';
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
  pages: PacketFacts['pages'] = new Map(),
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
    pages,
    edges: [],
    access_tests: [],
  };
}

/** The check's row for a page the crawl requested at `url` and was answered at `final_url`. */
export const servedRow = (
  url: string,
  final_url: string,
  status_code?: number,
): [string, PageResult] => [url, { url, final_url, status_code } as PageResult];

/** The engine's verdict on one page for the check behind `type`: readPage, then the check's judge. */
export const engineVerdict = (type: ContentFixType, html: string): PageVerdict =>
  CONTENT_CHECKS[checkOf(type)].judge(readPage(html));

/**
 * Every string of a packet a reader is shown, over its own body and its other stacks' bodies: the
 * sections, `expect`, and what the readable command prints today and after the fix.
 */
export const shownText = (p: FixPacket): string[] =>
  [p, ...p.packets].flatMap((b) => [
    ...b.context,
    ...b.change,
    ...b.keep,
    b.verify.expect,
    ...(b.verify.see ? [b.verify.see.today, b.verify.see.after] : []),
  ]);

/** Names a platform gave its own markup or API, which a packet prints as the platform spells them. */
const PLATFORM_NAMES = [
  'the_author_posts_link',
  'article:published_time',
  'get_the_time',
  'the_time',
  'the_date',
];

/**
 * The snake_case words of `text`, the shape of this repository's enum values and keys, less the
 * platform's own names. A packet shows none: each is said in words.
 */
export function identifiersIn(text: string): string[] {
  const ours = PLATFORM_NAMES.reduce((t, name) => t.replaceAll(name, ''), text);
  return ours.match(/[a-z]+_[a-z_]+/g) ?? [];
}

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

/**
 * What each content builder's command is held to on a live site, beyond its own two states: a site
 * that redirects the engine's spelling of a page to the slashed one, and a record whose crawled
 * fields are hostile, run through `sh`.
 */
export function contentCommandOnSites(
  type: ContentFixType,
  pages: Record<SiteState, string>,
): void {
  describe(`${type}: the command on a trailing-slash site`, () => {
    it('requests the address the page is served at, fails before the fix and passes after', async () => {
      const serve = (html: string) => (req: IncomingMessage, res: ServerResponse) => {
        if (req.url === '/blog/a/') return void res.end(html);
        res.statusCode = req.url === '/blog/a' ? 301 : 404;
        if (res.statusCode === 301) res.setHeader('location', '/blog/a/');
        res.end('<html><body>Moved</body></html>');
      };
      const site = await twoStateSite({ broken: serve(pages.broken), fixed: serve(pages.fixed) });
      open.push(site);
      const page = `${site.base}/blog/a`;
      const facts = contentFacts('every_crawler', null, new Map([servedRow(page, `${page}/`)]));
      const packet = writePacket(type, contentRecord(type, { affected_urls: [page] }), facts)!;
      expect(packet.verify.command).toContain(`'${page}/'`);
      expect(packet.context).toContain(`Failing page: \`${page}/\`.`);
      const run = await inBothStates(site, packet.verify.command);
      expect(run.broken.status).not.toBe(0);
      expect(run.fixed.status).toBe(0);
    });
  });

  describe(`${type}: the command on a site whose page answers 301 to another address`, () => {
    it('requests the address that answered 200, fails before the fix and passes after', async () => {
      const serve = (html: string) => (req: IncomingMessage, res: ServerResponse) => {
        if (req.url === '/en/blog/a') return void res.end(html);
        res.statusCode = 301;
        res.setHeader('location', '/en/blog/a');
        res.end('<html><body>Moved</body></html>');
      };
      const site = await twoStateSite({ broken: serve(pages.broken), fixed: serve(pages.fixed) });
      open.push(site);
      const page = `${site.base}/blog/a`;
      const landed = `${site.base}/en/blog/a`;
      const facts = contentFacts('every_crawler', null, new Map([servedRow(page, landed, 200)]));
      const packet = writePacket(type, contentRecord(type, { affected_urls: [page] }), facts)!;
      expect(packet.verify.command).toContain(`'${landed}'`);
      // the page keeps its own address where the packet names it
      expect(packet.context).toContain(`Failing page: \`${page}\`.`);
      const run = await inBothStates(site, packet.verify.command);
      expect(run.broken.status).not.toBe(0);
      expect(run.fixed.status).toBe(0);
      // requested at its own address the command reads the redirect's body, fixed or not
      const own = writePacket(type, contentRecord(type, { affected_urls: [page] }), contentFacts())!;
      expect((await runCommand(own.verify.command)).status).not.toBe(0);
    });
  });

  describe(`${type}: the command and how the page is answered`, () => {
    const run = async (serve: (html: string) => (req: IncomingMessage, res: ServerResponse) => void) => {
      const site = await twoStateSite({ broken: serve(pages.broken), fixed: serve(pages.fixed) });
      open.push(site);
      const record = contentRecord(type, { affected_urls: [`${site.base}/blog/a`] });
      return inBothStates(site, writePacket(type, record, contentFacts())!.verify.command);
    };

    it('reads a page from a server that gzips whatever the request accepts', async () => {
      const { broken, fixed } = await run((html) => (_req, res) => {
        res.setHeader('content-encoding', 'gzip');
        res.end(gzipSync(html));
      });
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });

    it('does not pass on an error page that carries the fixed markup', async () => {
      const { broken, fixed } = await run((html) => (_req, res) => {
        res.statusCode = 404;
        res.end(html);
      });
      expect(broken.status).not.toBe(0);
      expect(fixed.status).not.toBe(0);
      expect(fixed.stderr).toMatch(/404/);
    });
  });

  describe(`${type}: a hostile record's command, run`, () => {
    it('makes one request for the page and nothing else, in both states', async () => {
      const seen: string[] = [];
      const serve = (html: string) => (req: IncomingMessage, res: ServerResponse) => {
        seen.push(req.url ?? '');
        res.end(html);
      };
      const site = await twoStateSite({ broken: serve(pages.broken), fixed: serve(pages.fixed) });
      open.push(site);
      const hostile = HOSTILE_FRAGMENTS.join('');
      // a `#` would end the path: what follows it is a fragment, which no request carries
      const page = new URL(`${site.base}/blog/${hostile.replaceAll('#', '')}?q=${hostile}`).href;
      const record = contentRecord(type, {
        template_key: hostile,
        key: `x:${hostile}`,
        affected_urls: [page],
      });
      const packet = writePacket(type, record, contentFacts())!;
      for (const text of [...shownText(packet), packet.verify.command]) {
        expect(UNSHOWN.test(text)).toBe(false);
      }
      const run = await inBothStates(site, packet.verify.command);
      expect(run.broken.status).not.toBe(0);
      expect(run.fixed.status).toBe(0);
      expect(run.broken.stderr + run.fixed.stderr + run.broken.stdout + run.fixed.stdout).toBe('');
      // one request per run, each for the record's page as the URL parser spells it
      const { pathname, search } = new URL(page);
      expect(seen.map((u) => decodeURI(u))).toEqual(Array(2).fill(decodeURI(pathname + search)));
      expect(existsSync('pwned')).toBe(false);
    });
  });
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

  describe(`${type}: no identifier of ours in the text`, () => {
    it.each([null, ...PacketFrameworkSchema.options])(
      'says the check and every value in words (stack: %s)',
      (f) => {
        for (const s of ['every_crawler', 'no_crawler'] as const) {
          const p = writePacket(type, contentRecord(type), contentFacts(s, f))!;
          for (const text of shownText(p)) expect(identifiersIn(text), text).toEqual([]);
        }
      },
    );
  });

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
