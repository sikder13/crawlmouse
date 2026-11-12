import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AccessCauseSchema,
  FixPacketSchema,
  type AccessTest,
  type PageResult,
} from '@crawlmouse/types/v2';
import { MITIGATION_HEADERS } from '../../../../worker/src/verdict/response.js';
import { accessRow } from '../../../fixtures/v2/build/rows.js';
import type { AccessDetection } from '../access/types.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { fingerprintOf } from '../detectors/fingerprint.js';
import {
  EDGE_VENDOR_SOURCES,
  edgeRuleBlocksCrawler,
  MITIGATION,
  PAGES_SHOWN,
} from './by-type/edge-rule-blocks-crawler.js';
import { compose } from './compose.js';
import { userAgentOf } from './crawler.js';
import { identifiersIn, pluralsAtOne } from './test-support/content.js';
import { NO_STACK } from './test-support/facts.js';
import { hostileText, outsideCodeSpans, UNSHOWN } from './test-support/hostile.js';
import type { RequestListener } from 'node:http';
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

const factsOf = (
  rows: AccessTest[],
  stack: PacketFacts['stack'] = NO_STACK,
  pages: PacketFacts['pages'] = new Map(),
): PacketFacts => ({
  homepage_url: 'https://a.test',
  stack,
  crawlers: [],
  pages,
  edges: [],
  access_tests: rows,
});

const CLOUDFLARE: PacketFacts['stack'] = {
  ...NO_STACK,
  edge: { vendor: 'Cloudflare', detected_from: 'a test' },
};

const SITE_PAGES = Array.from({ length: 8 }, (_, i) => `https://a.test/p/${i}`);
const allText = (p: ReturnType<typeof compose>) =>
  [p, ...p.packets].flatMap((b) => [
    ...b.context,
    ...b.change,
    ...b.keep,
    b.verify.expect,
    ...(b.verify.see ? [b.verify.see.today, b.verify.see.after] : []),
  ]);

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

  it.each(AccessCauseSchema.options)('says the cause %s in words', (cause) => {
    const { record, rows } = detected({
      crawler: 'PerplexityBot',
      pages: SITE_PAGES.slice(0, 2),
      cause,
      signatures: ['cf-ray', 'server: cloudflare'],
    });
    for (const stack of [NO_STACK, CLOUDFLARE]) {
      const p = compose(builder, record, factsOf(rows, stack));
      const named = p.context.find((l) => l.startsWith('Cause the responses name: '))!;
      expect(named).not.toContain('`');
      for (const text of allText(p)) expect(identifiersIn(text), text).toEqual([]);
    }
  });

  it('says each cause once', () => {
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES.slice(0, 3) });
    const causes = ['rate_limit_429', 'cloudflare_1020', 'rate_limit_429'] as const;
    const { context } = compose(
      builder,
      { ...record, evidence: { ...record.evidence, causes: [...causes] } },
      factsOf(rows),
    );
    expect(context).toContain(
      'Causes the responses name: Cloudflare’s error 1020, a rate limit (status 429).',
    );
  });

  it('names no URL its record does not hold', () => {
    // few enough pages that the list shows them all, so nothing hides in "more pages not shown"
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES.slice(0, 3) });
    expect(record.affected_urls.length).toBeLessThan(PAGES_SHOWN);
    // rows of another crawler on other pages are in the facts and are not this record's
    const others = [0, 1].map((i) =>
      accessRow(90 + i, `https://a.test/not-in-the-record-${i}`, 'GPTBot', 'allowed'),
    );
    const p = compose(builder, record, factsOf([others[0]!, ...rows, others[1]!], CLOUDFLARE));
    // the user-agent word is the registry's, and holds the operator's own URL
    const commands = [p.verify.command, p.verify.see!.command].map((c) =>
      c.replace(/-A '[^']*'/, ''),
    );
    const urls = [...allText(p), ...commands].flatMap((t) => t.match(/https?:\/\/[^\s`']+/g) ?? []);
    expect(urls.length).toBe(record.affected_urls.length + 2);
    for (const u of urls) expect(record.affected_urls, u).toContain(u.replace(/\/$/, ''));
  });

  it.each(['ClaudeBot', 'PerplexityBot', 'ChatGPT-User'])(
    'leaves the choice to the site owner for %s, worded by what the registry says it is for',
    (token) => {
      const { record, rows } = detected({ crawler: token, pages: SITE_PAGES });
      expect(compose(builder, record, factsOf(rows)).change[0]).toBe(
        `Decide first whether \`${token}\` should be let in. What it is for: ${entryOf(token).purpose} The audit records what was refused, not what the site intends, and a block can be deliberate: the choice is the site owner's. The steps below apply if it should be served.`,
      );
    },
  );

  it('writes that step for a crawler of each group the registry can request as', () => {
    const groups = new Set(
      CRAWLER_REGISTRY_V2.filter((e) => e.testable).map((e) => {
        const { record, rows } = detected({ crawler: e.token, pages: SITE_PAGES });
        expect(compose(builder, record, factsOf(rows)).change[0]).toMatch(/^Decide first whether/);
        return e.group;
      }),
    );
    expect(groups.size).toBeGreaterThan(1);
  });

  it('says one page in the singular, and two in the plural', () => {
    const one = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES.slice(0, 1) });
    const single = compose(builder, one.record, factsOf(one.rows)).context;
    expect(single[0]).toBe(
      '`PerplexityBot` was refused on the 1 sampled page the audit judged it on, by a rule that matches its user agent.',
    );
    expect(single).toContain(
      'On that page another identity was served from the same address (`OAI-SearchBot`), so the refusal is aimed at the user agent.',
    );
    expect(single.at(-1)).toBe('Page refused: `https://a.test/p/0`.');
    expect(compose(builder, { ...one.record, extent: null }, factsOf(one.rows)).context[0]).toBe(
      '`PerplexityBot` was refused on 1 sampled page by a rule that matches its user agent.',
    );
    const two = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES.slice(0, 2) });
    const both = compose(builder, two.record, factsOf(two.rows)).context;
    expect(both[0]).toMatch(/^`PerplexityBot` was refused on 2 of the 2 sampled pages the audit/);
    expect(both.join('\n')).toMatch(/On 2 of those pages another identity/);
    expect(both.at(-1)).toBe('Pages refused: `https://a.test/p/0`, `https://a.test/p/1`.');
    expect(compose(builder, { ...two.record, extent: null }, factsOf(two.rows)).context[0]).toBe(
      '`PerplexityBot` was refused on 2 sampled pages by a rule that matches its user agent.',
    );
  });

  it('says 1 of anything in the singular: each count at 1 and at 2 (property)', () => {
    const oneOrTwo = fc.constantFrom(1, 2);
    fc.assert(
      fc.property(
        fc.constantFrom(1, 2, PAGES_SHOWN + 1, PAGES_SHOWN + 2),
        fc.constantFrom(0, 1, 2),
        fc.constantFrom(0, 1, 2, 5, 6),
        oneOrTwo,
        oneOrTwo,
        fc.constantFrom(NO_STACK, CLOUDFLARE),
        fc.boolean(),
        (refused, served, headers, statuses, witnessed, stack, noExtent) => {
          const { record, rows } = detected({
            crawler: 'PerplexityBot',
            pages: SITE_PAGES.slice(0, refused),
            judged: refused + served,
            signatures: Array.from({ length: headers }, (_, i) => `x-h${i}: v`),
          });
          const shaped = rows.map((t, i) => ({
            ...t,
            raw_status: i < statuses ? 403 + i : 403,
            witness: i < witnessed ? t.witness : null,
          }));
          const p = compose(
            builder,
            noExtent ? { ...record, extent: null } : record,
            factsOf(shaped, stack),
          );
          for (const text of allText(p)) expect(pluralsAtOne(text), text).toEqual([]);
        },
      ),
    );
  });

  it('names one status, one cause and one header in the singular', () => {
    const { record, rows } = detected({
      crawler: 'PerplexityBot',
      pages: SITE_PAGES.slice(0, 1),
      cause: 'cloudflare_1020',
      signatures: ['cf-ray'],
    });
    const one = compose(builder, record, factsOf(rows)).context;
    expect(one).toContain('Status of the refused request: 403.');
    expect(one).toContain('Cause the response names: Cloudflare’s error 1020.');
    expect(one).toContain('Response header: `cf-ray`.');
    const two = detected({
      crawler: 'PerplexityBot',
      pages: SITE_PAGES.slice(0, 2),
      signatures: ['cf-ray', 'server: cloudflare'],
    });
    const causes = ['cloudflare_1020', 'rate_limit_429'] as const;
    const both = compose(
      builder,
      { ...two.record, evidence: { ...two.record.evidence, causes: [...causes] } },
      factsOf(two.rows),
    ).context;
    expect(both).toContain('Status of the refused requests: 403 (2 requests).');
    expect(both).toContain(
      'Causes the responses name: Cloudflare’s error 1020, a rate limit (status 429).',
    );
    expect(both).toContain('Response headers: `cf-ray`, `server: cloudflare`.');
  });

  it('gives the same packet whatever order the record lists its pages, causes and headers in', () => {
    const { record, rows } = detected({
      crawler: 'PerplexityBot',
      pages: SITE_PAGES,
      cause: 'cloudflare_1020',
      signatures: ['server: cloudflare', 'cf-ray'],
    });
    const reordered: AccessDetection = {
      ...record,
      affected_urls: [...record.affected_urls].reverse(),
      evidence: {
        ...record.evidence,
        access_test_ids: [...record.evidence.access_test_ids].reverse(),
        pages: [...record.evidence.pages].reverse(),
        signatures: [...record.evidence.signatures].reverse(),
      },
    };
    expect(reordered.affected_urls).not.toEqual(record.affected_urls);
    expect(JSON.stringify(compose(builder, reordered, factsOf([...rows].reverse())))).toBe(
      JSON.stringify(compose(builder, record, factsOf(rows))),
    );
  });

  it('names a refused page at the address its server answered at', () => {
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: ['https://a.test/p'] });
    const pages = new Map([
      [
        'https://a.test/p',
        { url: 'https://a.test/p', final_url: 'https://a.test/p/' } as PageResult,
      ],
    ]);
    const p = compose(builder, record, factsOf(rows, NO_STACK, pages));
    expect(p.context.at(-1)).toBe('Page refused: `https://a.test/p/`.');
    expect(p.verify.command).toContain(" 'https://a.test/p/' | awk ");
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
    // without the 1020 cause: the features the Security Events log can name, each from its page
    const noCause = detected({ crawler: 'PerplexityBot', pages: SITE_PAGES });
    const cf = compose(builder, noCause.record, factsOf(noCause.rows, CLOUDFLARE)).change;
    expect(cf[1]).toMatch(/^In the Cloudflare dashboard open Security > Analytics, Events tab/);
    expect(cf.join('\n')).toMatch(/Security rules page/);
    expect(cf.join('\n')).toMatch(/in AI Crawl Control, select Allow in the Actions column/);
    expect(cf.join('\n')).toMatch(/Bot Fight Mode: it cannot be bypassed or skipped/);
    expect(cf.join('\n')).not.toMatch(/1020/);
  });

  it('for error 1020, names what Cloudflare’s page says answers with it, and not a custom rule or AI Crawl Control as the cause', () => {
    const { record, rows } = detected({
      crawler: 'PerplexityBot',
      pages: SITE_PAGES,
      cause: 'cloudflare_1020',
    });
    const cf = compose(builder, record, factsOf(rows, CLOUDFLARE)).change;
    expect(cf.slice(1, -1)).toEqual([
      "Cloudflare answered with error 1020. Cloudflare's page for that error says it is returned when a security rule with a Block action and no custom response matched the request, gives API Shield schema validation and JWT validation as examples, and says a request blocked by a WAF custom rule or a WAF managed rule does not get it.",
      "In the Cloudflare dashboard open Security > Analytics, Events tab, and find a refused request: the event shows which security feature and rule blocked it. Cloudflare's page does not list every feature that answers with error 1020, so the event is what names it.",
      'Update the configuration of that feature or rule so that it no longer blocks `PerplexityBot`.',
    ]);
    expect(cf.join('\n')).not.toMatch(
      /Security rules page|AI Crawl Control|Bot Fight Mode|access policy/,
    );
    // the page the steps rest on says the sentence the steps repeat
    expect(EDGE_VENDOR_SOURCES[0]!.supports).toMatch(
      /requests blocked by WAF custom rules or WAF managed rules do not get it/,
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

  it('on a site that redirects the page to its slashed address: fails while refused, passes once served', async () => {
    const ua = userAgentOf(entryOf('PerplexityBot'));
    const serve =
      (refuse: boolean): RequestListener =>
      (req, res) => {
        if (req.url === '/p') {
          res.statusCode = 301;
          res.setHeader('location', '/p/');
        } else if (refuse && String(req.headers['user-agent']).includes(ua)) {
          res.statusCode = 403;
        }
        res.end('<html><body>page</body></html>');
      };
    site = await twoStateSite({ broken: serve(true), fixed: serve(false) });
    const page = `${site.base}/p`;
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: [page] });
    const pages = new Map([[page, { url: page, final_url: `${page}/` } as PageResult]]);
    const { command } = compose(builder, record, factsOf(rows, NO_STACK, pages)).verify;
    expect(command).toContain(`'${page}/'`);
    const { broken, fixed } = await inBothStates(site, command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(fixed.stdout).toBe('');
    // without the row's served address the command reads the redirect, in both states
    const slashless = compose(builder, record, factsOf(rows)).verify.command;
    expect((await runCommand(slashless)).status).not.toBe(0);
  });

  it('on a site whose page answers 301 to another address: requests the address that answered 200', async () => {
    const ua = userAgentOf(entryOf('PerplexityBot'));
    const serve =
      (refuse: boolean): RequestListener =>
      (req, res) => {
        if (req.url === '/') {
          res.statusCode = 301;
          res.setHeader('location', '/en/');
        } else if (refuse && String(req.headers['user-agent']).includes(ua)) {
          res.statusCode = 403;
        }
        res.end('<html><body>page</body></html>');
      };
    site = await twoStateSite({ broken: serve(true), fixed: serve(false) });
    const page = site.base;
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: [page] });
    const pages = new Map([
      [page, { url: page, final_url: `${page}/en/`, status_code: 200 } as PageResult],
    ]);
    const p = compose(builder, record, factsOf(rows, NO_STACK, pages));
    expect(p.verify.command).toContain(`'${page}/en/'`);
    // the page keeps its own address where the packet names it
    expect(p.context).toContain(`Page refused: \`${page}\`.`);
    const { broken, fixed } = await inBothStates(site, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    // requested at its own address the command reads the redirect, fixed or not
    const own = compose(builder, record, factsOf(rows)).verify.command;
    site.use('fixed');
    expect((await runCommand(own)).status).not.toBe(0);
  });

  it('the readable command prints the status: the audit’s today, 200 once served', async () => {
    site = await siteRefusing('PerplexityBot');
    const { record, rows } = detected({
      crawler: 'PerplexityBot',
      pages: [`${site.base}/products/b`, `${site.base}/products/a`],
    });
    const { verify } = compose(builder, record, factsOf(rows));
    const ua = userAgentOf(entryOf('PerplexityBot'));
    expect(verify.see!.command).toBe(
      `curl -sS -o /dev/null -w '%{http_code}\\n' -A '${ua}' '${site.base}/products/a'`,
    );
    const { broken, fixed } = await inBothStates(site, verify.see!.command);
    expect(broken.stdout).toBe('403\n');
    expect(fixed.stdout).toBe('200\n');
    expect(verify.see!.today).toBe(
      '`403`: the status the audit’s request for this page as `PerplexityBot` was answered with.',
    );
    expect(verify.see!.after).toBe(
      '`200`. The exact check below also requires that no challenge header comes with it.',
    );
    expect(site.userAgents()).toEqual(Array(2).fill(ua));
  });

  it('the readable command’s `today` says so when the rows hold no status for the page', () => {
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: ['https://a.test/p'] });
    const none = compose(builder, record, factsOf([{ ...rows[0]!, raw_status: null }])).verify;
    expect(none.see!.today).toBe(
      'The audit recorded no status for its request for this page as `PerplexityBot`.',
    );
    // the readable command requests the address the exact check requests
    const pages = new Map([
      [
        'https://a.test/p',
        { url: 'https://a.test/p', final_url: 'https://a.test/en/', status_code: 200 } as PageResult,
      ],
    ]);
    const moved = compose(builder, record, factsOf(rows, NO_STACK, pages)).verify;
    expect(moved.command).toContain(" 'https://a.test/en/' | ");
    expect(moved.see!.command).toMatch(/ 'https:\/\/a\.test\/en\/'$/);
  });

  it('passes behind 103 Early Hints once fixed: the last status line decides', async () => {
    const ua = userAgentOf(CRAWLER_REGISTRY_V2.find((e) => e.token === 'PerplexityBot')!);
    const serve =
      (refuse: boolean): RequestListener =>
      (req, res) => {
        const send = () => {
          if (refuse && String(req.headers['user-agent']).includes(ua)) res.statusCode = 403;
          res.end('<html><body>page</body></html>');
        };
        res.writeEarlyHints({ link: '</style.css>; rel=preload; as=style' }, send);
      };
    site = await twoStateSite({ broken: serve(true), fixed: serve(false) });
    const page = `${site.base}/p`;
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: [page] });
    const { command } = compose(builder, record, factsOf(rows)).verify;
    const { broken, fixed } = await inBothStates(site, command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('does not pass on a 200 that carries a challenge header the worker reads, and says what it does not read', async () => {
    expect(MITIGATION).toEqual(MITIGATION_HEADERS);
    let headers: Record<string, string> = {};
    site = await twoStateSite({
      broken: (_req, res) => {
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        res.end('<html><title>Just a moment...</title></html>');
      },
      fixed: (_req, res) => void res.end('<html><body>page</body></html>'),
    });
    const { record, rows } = detected({ crawler: 'PerplexityBot', pages: [`${site.base}/a`] });
    const { command, expect: expected } = compose(builder, record, factsOf(rows)).verify;
    for (const [header, value] of MITIGATION_HEADERS) {
      headers = { [header]: value };
      expect((await runCommand(command)).status, header).not.toBe(0);
      headers = { [header.toUpperCase()]: `${value}; x` };
      expect((await runCommand(command)).status, header).not.toBe(0);
    }
    // the limit: a block page with status 200 and no such header is not told apart
    headers = {};
    expect((await runCommand(command)).status).toBe(0);
    expect(expected).toContain(
      'with no challenge header (`cf-mitigated`, `x-vercel-mitigated`), and prints nothing.',
    );
    expect(expected).toContain(
      'The command reads the status and those headers, not the body: a block page served with status 200 and none of those headers passes.',
    );
    site.use('fixed');
    expect((await runCommand(command)).status).toBe(0);
  });

  it('does not pass on a redirect, a challenge status, or a site that is not there', async () => {
    let status = 302;
    site = await twoStateSite({
      broken: (req, res) => {
        // the challenge page itself answers 200: a command that followed the redirect would pass
        res.statusCode = req.url === '/challenge' ? 200 : status;
        if (res.statusCode === 302) res.setHeader('location', '/challenge');
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
        for (const t of [...allText(p), p.verify.command, p.verify.see!.command]) {
          expect(UNSHOWN.test(t)).toBe(false);
        }
        // the readable command is the same words whatever the site put in its record
        const words = (command: string) => command.replace(/ 'https?:[^']*'$/, ' URL');
        expect(words(p.verify.see!.command)).toBe(words(q.verify.see!.command));
      }),
    );
  });
});
