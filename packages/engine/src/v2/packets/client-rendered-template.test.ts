import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { FixPacketSchema } from '@crawlmouse/types/v2';
import {
  detectRendered,
  type RenderedDetection,
  type RenderedInputPage,
} from '../detectors/rendered.js';
import { measurePage } from '../render/page.js';
import { READABLE_FROM } from '../render/state.js';
import {
  clientRenderedTemplate,
  PAGES_SHOWN,
  wordsNeeded,
} from './by-type/client-rendered-template.js';
import { jsOnlyNavigation } from './by-type/js-only-navigation.js';
import { compose } from './compose.js';
import { NO_STACK } from './test-support/facts.js';
import { hostileText, outsideCodeSpans, UNSHOWN } from './test-support/hostile.js';
import {
  inBothStates,
  runCommand,
  twoStateSite,
  type TwoStateSite,
} from './test-support/verify.js';
import type { PacketBuilder, PacketFacts } from './types.js';

const builder = clientRenderedTemplate as PacketBuilder<RenderedDetection>;

const T = '/guides/{slug}';
const SERVED = [{ ua: 'OAI-SearchBot', verdict: 'allowed' as const }];

const factsOf = (crawlers: PacketFacts['crawlers'] = SERVED): PacketFacts => ({
  homepage_url: 'https://a.test',
  stack: NO_STACK,
  crawlers,
  pages: new Map(),
  edges: [],
  access_tests: [],
});

/** A detected record of template T: `rendered` pages as [raw, rendered] words, and `more` not rendered. */
function detected(base: string, rendered: [number, number][], more = 0): RenderedDetection {
  const pages: RenderedInputPage[] = [
    ...rendered.map(([raw_words, rendered_words], i) => ({
      url: `${base}/guides/g-${i}`,
      template_key: T,
      kind: 'content' as const,
      status_code: 200,
      is_html: true,
      without_js: {
        raw_words,
        rendered_words,
        text_share: raw_words / rendered_words,
        state: 'empty_shell' as const,
      },
    })),
    ...Array.from({ length: more }, (_, i) => ({
      url: `${base}/guides/unrendered-${i}`,
      template_key: T,
      kind: 'content' as const,
      status_code: 200,
      is_html: true,
      without_js: null,
    })),
  ];
  const [record] = detectRendered(pages);
  if (record?.state !== 'detected') throw new Error('the test record is not detected');
  return record;
}

const allText = (p: ReturnType<typeof compose>) =>
  [p, ...p.packets].flatMap((b) => [...b.context, ...b.change, ...b.keep, b.verify.expect]);

describe('the client-rendered template packet, from its record', () => {
  it('states the template, the pages rendered of the pages graded, and the words of each rendered page', () => {
    const record = detected(
      'https://a.test',
      [
        [41, 312],
        [38, 290],
      ],
      29,
    );
    expect(compose(builder, record, factsOf()).context).toEqual([
      'The template `/guides/{slug}` serves its main content by JavaScript. The audit rendered 2 of its 31 graded pages in a browser, and without JavaScript each of them is an empty shell.',
      '`https://a.test/guides/g-0`: 41 words in the HTML response, 312 once rendered.',
      '`https://a.test/guides/g-1`: 38 words in the HTML response, 290 once rendered.',
      'Across the rendered pages, a median of 13% of the rendered words is in the HTML response. A crawler that does not run JavaScript reads the smaller number.',
      'Measured by rendering 2 pages. The other 29 graded pages of the template were not rendered: the finding is for the template by this sample.',
    ]);
  });

  it('bounds the page lines and says how many it left out; says when every page was rendered', () => {
    const many = detected(
      'https://a.test',
      Array.from({ length: PAGES_SHOWN + 2 }, () => [10, 100] as [number, number]),
    );
    const { context } = compose(builder, many, factsOf());
    expect(context.filter((l) => l.startsWith('`https://'))).toHaveLength(PAGES_SHOWN);
    expect(context).toContain('2 more rendered pages are not shown.');
    expect(context.at(-1)).toBe(
      `Measured by rendering ${PAGES_SHOWN + 2} pages: every graded page of the template.`,
    );
    const one = compose(builder, detected('https://a.test', [[10, 100]]), factsOf()).context;
    expect(one[0]).toMatch(/rendered 1 of its 1 graded page in a browser/);
    expect(one.at(-1)).toBe('Measured by rendering 1 page: every graded page of the template.');
  });

  it('names no URL its record does not hold, and verifies on a rendered page of the record', () => {
    const record = detected('https://a.test', [[41, 312]], 3);
    const p = compose(builder, record, factsOf());
    const command = p.verify.command.replace(/-A '[^']*'/, '');
    const urls = [...allText(p), command].flatMap((t) => t.match(/https?:\/\/[^\s`']+/g) ?? []);
    expect(urls.length).toBeGreaterThan(1);
    for (const u of urls)
      expect(
        record.evidence.pages.map((x) => x.url),
        u,
      ).toContain(u);
  });

  it('writes a body for the stacks whose documentation supports one, each with its sources', () => {
    const p = compose(builder, detected('https://a.test', [[41, 312]]), factsOf());
    expect(p.framework).toBe('generic');
    expect(p.frameworks).toEqual(['generic', 'nextjs', 'shopify_hydrogen']);
    const next = p.packets.find((b) => b.framework === 'nextjs')!;
    expect(next.change.join('\n')).toMatch(/App Router/);
    expect(next.change.join('\n')).toMatch(/Pages Router/);
    expect(next.change.join('\n')).toMatch(/getStaticProps.*getServerSideProps/);
    expect(p.packets.find((b) => b.framework === 'shopify_hydrogen')!.change.join('\n')).toMatch(
      /loader/,
    );
    const hosts: Record<string, RegExp> = {
      nextjs: /^https:\/\/nextjs\.org\/docs\//,
      shopify_hydrogen: /^https:\/\/shopify\.dev\/docs\//,
    };
    expect(Object.keys(builder.stacks).sort()).toEqual(Object.keys(hosts).sort());
    for (const [framework, body] of Object.entries(builder.stacks)) {
      expect(body.sources.length).toBeGreaterThan(0);
      for (const s of body.sources) {
        expect(s.url).toMatch(hosts[framework]!);
        expect(s.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(s.supports.length).toBeGreaterThan(10);
      }
    }
  });

  it('keeps the URLs, the content and the interactivity', () => {
    const { keep } = compose(builder, detected('https://a.test', [[41, 312]]), factsOf());
    expect(keep.join('\n')).toMatch(/URL/);
    expect(keep.join('\n')).toMatch(/same headings and text/);
    expect(keep.join('\n')).toMatch(/hydrate/);
  });

  it('requests as a crawler the site serves; with none, as no crawler, and says so', () => {
    const record = detected('https://a.test', [[41, 312]]);
    const served = compose(builder, record, factsOf());
    expect(served.verify.ua).toBe('OAI-SearchBot');
    expect(served.verify.command).toMatch(/^curl -sS -A '[^']*OAI-SearchBot/);
    expect(served.context.join('\n')).not.toMatch(/No tested AI crawler/);
    const none = compose(
      builder,
      record,
      factsOf([{ ua: 'OAI-SearchBot', verdict: 'blocked_by_ua_rule' }]),
    );
    expect(none.verify.ua).toBe(null);
    expect(none.verify.command).toMatch(/^curl -sS 'https:\/\/a\.test\/guides\/g-0' \|/);
    expect(none.context.at(-1)).toBe(
      'No tested AI crawler is served by the site today, so the check below requests the page with no crawler’s user agent.',
    );
  });

  it('asks for the words at which the page would read as readable, from the record', () => {
    const record = detected('https://a.test', [[41, 312]]);
    expect(wordsNeeded(record.evidence.pages[0]!)).toBe(Math.ceil(READABLE_FROM * 312));
    const { verify } = compose(builder, record, factsOf());
    expect(verify.command).toContain("need='250'");
    expect(verify.expect).toBe(
      'Prints its count of the words in the HTML response outside scripts, styles and navigation, and exits 0 when that is 250 or more: 80% of the 312 words the audit counted once rendered. The audit counted 41 without JavaScript. The count is the command’s own and differs a little from the audit’s.',
    );
  });
});

describe('js_only_navigation', () => {
  it('has no packet, and says what was not measured', () => {
    expect(jsOnlyNavigation.kind).toBe('none');
    if (jsOnlyNavigation.kind !== 'none') return;
    expect(jsOnlyNavigation.reason).toMatch(/word counts/);
    expect(jsOnlyNavigation.reason).toMatch(/No link of the rendered side is kept/);
  });
});

const words = (n: number, stem: string) =>
  Array.from({ length: n }, (_, i) => `${stem}${i}`).join(' ');

/** The guide's text, as a script fills it in and as a server would render it. */
const BODY = `<h2>What to pack</h2><p>${words(180, 'pack')}</p><h2>Staying warm</h2><p>${words(180, 'warm')}</p>`;

/**
 * A page of an app whose body arrives by JavaScript. The served header and intro make it a content
 * page; the body is in an inline JSON state and a bootstrap script, which a tag strip that keeps
 * script text would count as words.
 */
function guidePage(o: { body: string; noscript?: string }): string {
  const state = JSON.stringify({ guide: { html: BODY, summary: words(200, 'state') } }).replace(
    /</g,
    '\\u003c',
  );
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Winter camping basics</title>',
    '<style>.hero > h1 { font-size: 2rem } /* a rule with words in it */</style>',
    '<script src="/static/app.js" defer></script></head><body>',
    '<header><nav><a href="/">Home</a> <a href="/guides">Guides</a></nav></header>',
    '<main><h1>Winter camping basics</h1>',
    '<p>Winter camping asks more of your kit and your planning than a summer trip does, and this guide',
    'covers what to pack and how to stay warm overnight.</p>',
    `<div id="root">${o.body}</div></main>`,
    `<script id="__STATE__" type="application/json">${state}</script>`,
    `<script>window.__BOOT__ = function (a, b) { if (a < b) { return "${words(120, 'boot')}" } }</script>`,
    `<noscript>${o.noscript ?? 'You need to enable JavaScript to read this guide.'}</noscript>`,
    '<footer><p>Built Site outdoor shop</p></footer></body></html>',
  ].join('\n');
}

const SHELL = guidePage({ body: '' });
const SERVER_RENDERED = guidePage({ body: BODY });

describe('the client-rendered template verify command', () => {
  let site: TwoStateSite | null = null;
  afterEach(async () => {
    await site?.close();
    site = null;
  });

  const html =
    (body: string) =>
    (_req: unknown, res: { setHeader(n: string, v: string): void; end(b: string): void }) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(body);
    };

  /** The record the render step and the detector make of the shell, on a page of `base`. */
  function measured(base: string): RenderedDetection {
    const m = measurePage({ staticHtml: SHELL, renderedHtml: SERVER_RENDERED, previous: null });
    if (!m.measured) throw new Error('the shell was not measured');
    expect(m.without_js.state).toBe('empty_shell');
    const [record] = detectRendered([
      {
        url: `${base}/guides/winter-camping-basics`,
        template_key: T,
        kind: 'content',
        status_code: 200,
        is_html: true,
        without_js: m.without_js,
      },
    ]);
    return record!;
  }

  it('fails on the script-heavy shell and passes once the body is in the HTML response', async () => {
    site = await twoStateSite({ broken: html(SHELL), fixed: html(SERVER_RENDERED) });
    const record = measured(site.base);
    const need = wordsNeeded(record.evidence.pages[0]!);
    const { verify } = compose(builder, record, factsOf());
    expect(verify.command).toMatch(/^curl /);

    // The shell is script-heavy: a tag strip that keeps script text counts more than is asked for.
    const naive = await runCommand(
      `curl -sS '${site.base}/guides/winter-camping-basics' | sed -e 's/<[^>]*>/ /g' | wc -w`,
    );
    expect(Number(naive.stdout)).toBeGreaterThan(need);

    const { broken, fixed } = await inBothStates(site, verify.command);
    expect(broken.status).not.toBe(0);
    expect(Number(broken.stdout)).toBeLessThan(need);
    expect(fixed.status).toBe(0);
    expect(Number(fixed.stdout)).toBeGreaterThanOrEqual(need);
    expect(
      site
        .userAgents()
        .slice(-2)
        .every((ua) => ua.includes('OAI-SearchBot')),
    ).toBe(true);
  });

  it('counts within a few words of the audit’s own count on both sides', async () => {
    site = await twoStateSite({ broken: html(SHELL), fixed: html(SERVER_RENDERED) });
    const record = measured(site.base);
    const page = record.evidence.pages[0]!;
    const { broken, fixed } = await inBothStates(
      site,
      compose(builder, record, factsOf()).verify.command,
    );
    expect(Math.abs(Number(broken.stdout) - page.raw_words)).toBeLessThanOrEqual(5);
    expect(Math.abs(Number(fixed.stdout) - page.rendered_words)).toBeLessThanOrEqual(5);
  });

  it('does not pass on text put in a noscript element, or on a site that is not there', async () => {
    site = await twoStateSite({
      broken: html(guidePage({ body: '', noscript: BODY })),
      fixed: html(SERVER_RENDERED),
    });
    const { command } = compose(builder, measured(site.base), factsOf()).verify;
    expect((await runCommand(command)).status).not.toBe(0);
    await site.close();
    site = null;
    expect((await runCommand(command)).status).not.toBe(0);
  });

  it('requesting as no crawler: the same two states', async () => {
    site = await twoStateSite({ broken: html(SHELL), fixed: html(SERVER_RENDERED) });
    const { verify } = compose(builder, measured(site.base), factsOf([]));
    expect(verify.ua).toBe(null);
    const { broken, fixed } = await inBothStates(site, verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(site.userAgents().every((ua) => ua.startsWith('curl/'))).toBe(true);
  });
});

describe('the client-rendered template packet over hostile records (properties)', () => {
  const hostileUrl = fc.tuple(hostileText(3), hostileText(3)).map(([p, q]) => {
    try {
      return new URL(`https://a.test/${p}?${q}`).href;
    } catch {
      return 'https://a.test/';
    }
  });
  /** A record whose crawled fields (the template key and the URLs) are the site's to choose. */
  const hostile = fc
    .record({
      template: hostileText(),
      urls: fc.uniqueArray(hostileUrl, { minLength: 1, maxLength: 6 }),
      raw: fc.integer({ min: 0, max: 80 }),
      rendered: fc.integer({ min: 300, max: 4000 }),
      more: fc.integer({ min: 0, max: 40 }),
      crawlers: fc.constantFrom<PacketFacts['crawlers']>(SERVED, []),
    })
    .map(({ template, urls, raw, rendered, more, crawlers }) => {
      const plain = detected(
        'https://a.test',
        urls.map(() => [raw, rendered]),
        more,
      );
      const sorted = [...urls].sort();
      const record: RenderedDetection = {
        ...plain,
        template_key: template,
        key: `shell:${template}`,
        affected_urls: sorted,
        evidence: { pages: plain.evidence.pages.map((p, i) => ({ ...p, url: sorted[i]! })) },
      };
      return { record, plain, facts: factsOf(crawlers) };
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
      fc.property(hostile, ({ record, plain, facts }) => {
        const p = compose(builder, record, facts);
        // The same record with harmless values in the same places: what is ours is the same text.
        const q = compose(builder, plain, facts);
        const ours = (t: string) =>
          outsideCodeSpans(t).replace(/ \((line )?cut from \d+ characters\)/g, '');
        expect(allText(p).map(ours)).toEqual(allText(q).map(ours));
        for (const t of [...allText(p), p.verify.command]) expect(UNSHOWN.test(t)).toBe(false);
      }),
    );
  });
});
