import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { FixPacketSchema, type AccessTest } from '@crawlmouse/types/v2';
import { accessRow } from '../../../fixtures/v2/build/rows.js';
import type { AccessDetection } from '../access/types.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { fingerprintOf } from '../detectors/fingerprint.js';
import {
  EDGE_VENDOR_SOURCES,
  edgeRuleBlocksCrawler,
  PAGES_SHOWN,
} from './by-type/edge-rule-blocks-crawler.js';
import { compose } from './compose.js';
import { userAgentOf } from './crawler.js';
import { NO_STACK } from './test-support/facts.js';
import { hostileText, outsideCodeSpans, UNSHOWN } from './test-support/hostile.js';
import {
  inBothStates,
  runCommand,
  twoStateSite,
  type TwoStateSite,
} from './test-support/verify.js';
import type { PacketBuilder, PacketFacts } from './types.js';

const builder = edgeRuleBlocksCrawler as PacketBuilder<AccessDetection>;
const entryOf = (token: string) => CRAWLER_REGISTRY_V2.find((e) => e.token === token)!;

interface Shape {
  crawler: string;
  /** The refused pages; each gets a worker row answered `status`. */
  pages: string[];
  judged?: number;
  status?: number;
  cause?: AccessTest['cause'];
  signatures?: string[];
  witness?: string;
}

/** A detected edge record over `pages`, and the worker rows it names. */
function detected(s: Shape): { record: AccessDetection; rows: AccessTest[] } {
  const entry = entryOf(s.crawler);
  const pages = [...s.pages].sort();
  const rows = pages.map(
    (page, i): AccessTest => ({
      // the contract's row, then what a crawled site chooses, as the engine reads it back
      ...accessRow(i + 1, 'https://a.test/', s.crawler, 'allowed'),
      page_url: page,
      verdict: 'blocked_by_ua_rule',
      raw_status: s.status ?? 403,
      cause: s.cause ?? null,
      tagged: true,
      witness: { role: 'crawler', ua: s.witness ?? 'OAI-SearchBot' },
    }),
  );
  const key = `edge:${s.crawler.toLowerCase()}`;
  return {
    rows,
    record: {
      type: 'edge_rule_blocks_crawler',
      fingerprint: fingerprintOf(key),
      key,
      crawler: entry.token,
      group: entry.group,
      scored: entry.scored,
      state: 'detected',
      reason: null,
      measured: pages.length / (s.judged ?? pages.length),
      extent: { matching: pages.length, of: s.judged ?? pages.length },
      recommendation_class: 'confirmed_defect',
      confidence: 'likely',
      intent: null,
      opens_fix: true,
      affected_urls: pages,
      evidence: {
        access_test_ids: rows.map((t) => t.id).sort(),
        pages,
        causes: s.cause ? rows.map(() => s.cause!) : [],
        signatures: s.signatures ?? [],
      },
    },
  };
}

const factsOf = (rows: AccessTest[], stack: PacketFacts['stack'] = NO_STACK): PacketFacts => ({
  homepage_url: 'https://a.test',
  stack,
  crawlers: [],
  pages: new Map(),
  edges: [],
  access_tests: rows,
});

const CLOUDFLARE: PacketFacts['stack'] = {
  ...NO_STACK,
  edge: { vendor: 'Cloudflare', detected_from: 'a test' },
};

const SITE_PAGES = Array.from({ length: 8 }, (_, i) => `https://a.test/p/${i}`);
const allText = (p: ReturnType<typeof compose>) =>
  [p, ...p.packets].flatMap((b) => [...b.context, ...b.change, ...b.keep, b.verify.expect]);

describe('the edge-rule packet, from its record', () => {
  it('states the crawler, the pages refused of the pages judged, and what the rows show', () => {
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES, judged: 20 });
    const p = compose(builder, record, factsOf(rows));
    expect(p.context).toEqual([
      '`PerplexityBot` was refused on 8 of the 20 sampled pages the audit judged it on, by a rule that matches its user agent.',
      'Status of the refused requests: 403 (8 requests).',
      'The responses name no product: the audit did not identify what holds the rule.',
      'On 8 of those pages another identity was served from the same address (`OAI-SearchBot`), so the refusal is aimed at the user agent.',
      'The audit sent this user agent with a Crawlmouse tag, from Crawlmouse’s address. What the operator’s own crawler gets is in the site’s logs.',
      'Pages refused: `https://a.test/p/0`, `https://a.test/p/1`, `https://a.test/p/2`, `https://a.test/p/3`, `https://a.test/p/4` and 3 more pages not shown.',
    ]);
    expect(p.frameworks).toEqual(['generic']);
  });

  it('renders each status, cause and header from the rows, and leaves out what they do not hold', () => {
    const { record, rows } = detected({
      crawler: 'PerplexityBot',
      pages: SITE_PAGES.slice(0, 3),
      cause: 'cloudflare_1020',
      signatures: ['cf-ray', 'server: cloudflare'],
    });
    rows[2] = { ...rows[2]!, raw_status: 429, tagged: false };
    const { context } = compose(builder, record, factsOf(rows));
    expect(context).toContain('Status of the refused requests: 403 (2 requests), 429 (1 request).');
    expect(context).toContain('Cause the responses name: Cloudflare’s error 1020.');
    expect(context).toContain('Response headers: `cf-ray`, `server: cloudflare`.');
    expect(context.join('\n')).not.toMatch(/Crawlmouse tag|no product/);
  });

  it('names no URL its record does not hold', () => {
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES });
    // a row of another crawler on another page is in the facts and is not this record's
    const other = accessRow(99, 'https://a.test/not-in-the-record', 'GPTBot', 'allowed');
    const p = compose(builder, record, factsOf([...rows, other], CLOUDFLARE));
    // the user-agent word is the registry's, and holds the operator's own URL
    const command = p.verify.command.replace(/-A '[^']*'/, '');
    const urls = [...allText(p), command].flatMap((t) => t.match(/https?:\/\/[^\s`']+/g) ?? []);
    expect(urls.length).toBeGreaterThan(PAGES_SHOWN);
    for (const u of urls) expect(record.affected_urls, u).toContain(u);
  });

  it('leaves the choice to the site owner for a training crawler, and to no one else', () => {
    const training = detected({ crawler: 'ClaudeBot', pages: SITE_PAGES });
    expect(entryOf('ClaudeBot').group).toBe('ai_training');
    expect(compose(builder, training.record, factsOf(training.rows)).change[0]).toMatch(
      /^Decide first whether `ClaudeBot` should be let in\. It is a training crawler.*the choice is the site owner's/,
    );
    const search = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES });
    expect(entryOf('PerplexityBot').group).not.toBe('ai_training');
    expect(compose(builder, search.record, factsOf(search.rows)).change.join('\n')).not.toMatch(
      /training crawler|Decide first/,
    );
  });

  it('names Cloudflare’s settings only when the check recorded Cloudflare as the edge', () => {
    const { record, rows } = detected({
      crawler: 'PerplexityBot',
      pages: SITE_PAGES,
      cause: 'cloudflare_1020',
    });
    const generic = compose(builder, record, factsOf(rows)).change.join('\n');
    expect(generic).not.toMatch(/Cloudflare|Bot Fight Mode|AI Crawl Control/);
    expect(generic).toMatch(/Find the rule that refuses requests whose User-Agent header contains/);
    const cf = compose(builder, record, factsOf(rows, CLOUDFLARE)).change;
    expect(cf[0]).toMatch(/^Cloudflare answered with error 1020/);
    expect(cf.join('\n')).toMatch(/Security rules page/);
    expect(cf.join('\n')).toMatch(/AI Crawl Control, Crawlers tab/);
    expect(cf.join('\n')).toMatch(/Bot Fight Mode: it cannot be bypassed or skipped/);
    // the 1020 sentence is the rows' cause, not the vendor's name
    const noCause = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES });
    expect(compose(builder, noCause.record, factsOf(noCause.rows, CLOUDFLARE)).change[0]).toMatch(
      /^In the Cloudflare dashboard open Security > Analytics/,
    );
  });

  it('cites a Cloudflare page, read on a date, for the Cloudflare steps', () => {
    expect(EDGE_VENDOR_SOURCES.length).toBeGreaterThanOrEqual(5);
    for (const s of EDGE_VENDOR_SOURCES) {
      expect(s.url).toMatch(/^https:\/\/developers\.cloudflare\.com\//);
      expect(s.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.supports.length).toBeGreaterThan(20);
    }
  });

  it('says what must not change', () => {
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES });
    const { keep } = compose(builder, record, factsOf(rows));
    expect(keep.join('\n')).toMatch(/other clauses/);
    expect(keep.join('\n')).toMatch(/robots\.txt/);
  });

  it('refuses a record whose crawler the registry cannot request as', () => {
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES });
    expect(() => compose(builder, { ...record, crawler: 'Googlebot' }, factsOf(rows))).toThrow(
      /cannot request as/,
    );
  });
});

describe('the edge-rule verify command', () => {
  let site: TwoStateSite | null = null;
  afterEach(async () => {
    await site?.close();
    site = null;
  });

  /** A site that refuses `token`'s user agent with 403 while broken, and serves everyone once fixed. */
  async function siteRefusing(token: string): Promise<TwoStateSite> {
    const ua = userAgentOf(entryOf(token));
    return twoStateSite({
      broken: (req, res) => {
        res.statusCode = String(req.headers['user-agent']).includes(ua) ? 403 : 200;
        res.end('<html><body>page</body></html>');
      },
      fixed: (_req, res) => void res.end('<html><body>page</body></html>'),
    });
  }

  it.each(['PerplexityBot', 'ClaudeBot'])(
    'as %s: fails while the user agent is refused, passes once it is served',
    async (token) => {
      site = await siteRefusing(token);
      const { record, rows } = detected({
        crawler: token,
        pages: [`${site.base}/products/b`, `${site.base}/products/a`],
      });
      const p = compose(builder, record, factsOf(rows));
      expect(p.verify.ua).toBe(token);
      expect(p.verify.command).toMatch(/^curl /);
      expect(p.verify.command).toContain(`'${site.base}/products/a'`);
      expect(p.verify.expect).toMatch(/The audit's request for it was answered 403\.$/);
      const { broken, fixed } = await inBothStates(site, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
      // the operator's string, or the token where the operator prints none (ClaudeBot)
      expect(site.userAgents()).toEqual(Array(2).fill(userAgentOf(entryOf(token))));
    },
  );

  it('does not pass on a redirect, a challenge status, or a site that is not there', async () => {
    let status = 302;
    site = await twoStateSite({
      broken: (_req, res) => {
        res.statusCode = status;
        if (status === 302) res.setHeader('location', '/challenge');
        res.end('x');
      },
      fixed: (_req, res) => void res.end('x'),
    });
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: [`${site.base}/a`] });
    const { command } = compose(builder, record, factsOf(rows)).verify;
    expect((await runCommand(command)).status).not.toBe(0);
    status = 503;
    expect((await runCommand(command)).status).not.toBe(0);
    await site.close();
    site = null;
    expect((await runCommand(command)).status).not.toBe(0);
  });
});

describe('the edge-rule packet over hostile records (properties)', () => {
  const hostileUrl = fc.tuple(hostileText(3), hostileText(3)).map(([p, q]) => {
    try {
      return new URL(`https://a.test/${p}?${q}`).href;
    } catch {
      return 'https://a.test/';
    }
  });
  /** A record whose crawled fields (URLs, header values, the witness) are the site's to choose. */
  const hostile = fc
    .record({
      crawler: fc.constantFrom('PerplexityBot', 'ClaudeBot', 'GPTBot', 'OAI-SearchBot'),
      pages: fc.uniqueArray(hostileUrl, { minLength: 1, maxLength: 9 }),
      signatures: fc.array(hostileText(), { maxLength: 6 }),
      witness: hostileText().map((t) => t || 'x'),
      cause: fc.constantFrom(null, 'cloudflare_1020' as const),
      stack: fc.constantFrom(NO_STACK, CLOUDFLARE),
    })
    .map(({ stack, ...s }) => {
      const { record, rows } = detected(s);
      return { record, facts: factsOf(rows, stack) };
    });

  it('gives the same packet, byte for byte, and one the contract accepts', () => {
    fc.assert(
      fc.property(hostile, ({ record, facts }) => {
        const p = compose(builder, record, facts);
        expect(JSON.stringify(compose(builder, structuredClone(record), facts))).toBe(
          JSON.stringify(p),
        );
        expect(FixPacketSchema.safeParse(p).success).toBe(true);
      }),
    );
  });

  it('shows nothing crawled outside a code span, and nothing that draws nothing', () => {
    fc.assert(
      fc.property(hostile, ({ record, facts }) => {
        const p = compose(builder, record, facts);
        // The same record with harmless values in the same places: what is ours is the same text.
        const plain = detected({
          crawler: record.crawler,
          pages: record.affected_urls.map((_, i) => `https://a.test/p/${i}`),
          signatures: record.evidence.signatures.map((_, i) => `h${i}`),
          witness: 'w',
          cause: facts.access_tests[0]!.cause,
        });
        const q = compose(builder, plain.record, factsOf(plain.rows, facts.stack));
        const ours = (t: string) =>
          outsideCodeSpans(t).replace(/ \((line )?cut from \d+ characters\)/g, '');
        const cut = / \(line cut from \d+ characters\)$/;
        allText(p).forEach((t, i) => {
          // a line compose cut ends where the cut fell; compose.test.ts holds its code span closed
          if (!cut.test(t)) expect(ours(t)).toBe(ours(allText(q)[i]!));
        });
        for (const t of [...allText(p), p.verify.command]) expect(UNSHOWN.test(t)).toBe(false);
      }),
    );
  });
});
