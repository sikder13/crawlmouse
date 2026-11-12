import { gzipSync } from 'node:zlib';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { FixPacketSchema, type PageResult } from '@crawlmouse/types/v2';
import {
  detectRendered,
  type RenderedDetection,
  type RenderedInputPage,
} from '../detectors/rendered.js';
import { measurePage } from '../render/page.js';
import { EMPTY_SHELL_LEAVES_ABOVE, jsTextState, READABLE_FROM } from '../render/state.js';
import {
  clientRenderedTemplate,
  PAGES_SHOWN,
  wordsNeeded,
} from './by-type/client-rendered-template.js';
import { jsOnlyNavigation } from './by-type/js-only-navigation.js';
import { compose } from './compose.js';
import { identifiersIn, pluralsAtOne } from './test-support/content.js';
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

const factsOf = (
  crawlers: PacketFacts['crawlers'] = SERVED,
  pages: PacketFacts['pages'] = new Map(),
): PacketFacts => ({
  homepage_url: 'https://a.test',
  stack: NO_STACK,
  crawlers,
  pages,
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
  [p, ...p.packets].flatMap((b) => [
    ...b.context,
    ...b.change,
    ...b.keep,
    b.verify.expect,
    ...(b.verify.see ? [b.verify.see.today, b.verify.see.after] : []),
  ]);

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
      'The HTML response of the template `/guides/{slug}` holds far fewer words than its pages show once rendered in a browser: the difference is content added in the browser. The audit rendered 2 of its 31 graded pages in a browser.',
      '`https://a.test/guides/g-0`: 41 words in the HTML response, 312 once rendered in a browser.',
      '`https://a.test/guides/g-1`: 38 words in the HTML response, 290 once rendered in a browser.',
      'Across the rendered pages, a median of 13% of the rendered words is in the HTML response. A crawler that does not run JavaScript reads the smaller number.',
      'Measured by rendering 2 pages. The other 29 graded pages of the template were not rendered: the finding is for the template by this sample.',
      'The audit renders only pages it grades. A route whose HTML response holds too little text to be graded is not rendered, so another template of the site can have the same fault unmeasured.',
    ]);
  });

  it('states what was measured and names no mechanism the record does not hold', () => {
    const p = compose(builder, detected('https://a.test', [[32, 312]], 3), factsOf());
    const text = allText(p).join('\n');
    expect(text).not.toMatch(/empty shell|by JavaScript|a script fetches|useEffect/);
    expect(p.change[0]).toBe(
      'Find what adds the content of the pages of `/guides/{slug}` in the browser. The audit measured the words, not what adds them.',
    );
    for (const body of p.packets) expect(body.change[0], body.framework).toMatch(/^Find what adds/);
  });

  it('shows no identifier of ours: every value is said in words', () => {
    for (const crawlers of [SERVED, []]) {
      const p = compose(builder, detected('https://a.test', [[41, 312]], 3), factsOf(crawlers));
      for (const text of allText(p)) expect(identifiersIn(text), text).toEqual([]);
    }
  });

  it('says one page in the singular, and two in the plural', () => {
    const one = compose(builder, detected('https://a.test', [[1, 100]]), factsOf()).context;
    expect(one[0]).toMatch(/The audit rendered its 1 graded page in a browser\.$/);
    expect(one[1]).toBe(
      '`https://a.test/guides/g-0`: 1 word in the HTML response, 100 once rendered in a browser.',
    );
    expect(one).toContain('Measured by rendering 1 page: every graded page of the template.');
    const two = compose(
      builder,
      detected('https://a.test', [
        [2, 100],
        [2, 100],
      ]),
      factsOf(),
    ).context;
    expect(two[0]).toMatch(/The audit rendered each of its 2 graded pages in a browser\.$/);
    expect(two[1]).toMatch(/: 2 words in the HTML response/);
    expect(two).toContain('Measured by rendering 2 pages: every graded page of the template.');
    const oneOfTwo = compose(builder, detected('https://a.test', [[2, 100]], 1), factsOf()).context;
    expect(oneOfTwo[0]).toMatch(/The audit rendered 1 of its 2 graded pages in a browser\.$/);
    expect(oneOfTwo).toContain(
      'Measured by rendering 1 page. The other 1 graded page of the template was not rendered: the finding is for the template by this sample.',
    );
    const shownPlus = (extra: number) =>
      compose(
        builder,
        detected(
          'https://a.test',
          Array.from({ length: PAGES_SHOWN + extra }, () => [10, 100] as [number, number]),
        ),
        factsOf(),
      ).context;
    expect(shownPlus(1)).toContain('1 more rendered page is not shown.');
    expect(shownPlus(2)).toContain('2 more rendered pages are not shown.');
  });

  it('says 1 of anything in the singular: each count at 1 and at 2 (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(1, 2, PAGES_SHOWN + 1, PAGES_SHOWN + 2),
        fc.constantFrom(0, 1, 2),
        fc.constantFrom<[number, number]>([1, 2], [1, 100], [2, 100], [0, 1]),
        fc.constantFrom<PacketFacts['crawlers']>(SERVED, []),
        (rendered, more, words, crawlers) => {
          const record = detected(
            'https://a.test',
            Array.from({ length: rendered }, () => words),
            more,
          );
          const p = compose(builder, record, factsOf(crawlers));
          for (const text of allText(p)) expect(pluralsAtOne(text), text).toEqual([]);
        },
      ),
    );
  });

  it('gives the same packet whatever order the record lists its rendered pages in', () => {
    const record = detected('https://a.test', [
      [41, 312],
      [38, 290],
      [12, 400],
    ]);
    const reordered: RenderedDetection = {
      ...record,
      affected_urls: [...record.affected_urls].reverse(),
      evidence: { pages: [...record.evidence.pages].reverse() },
    };
    expect(reordered.evidence.pages[0]).not.toEqual(record.evidence.pages[0]);
    expect(JSON.stringify(compose(builder, reordered, factsOf()))).toBe(
      JSON.stringify(compose(builder, record, factsOf())),
    );
  });

  it('names a rendered page at the address its server answered at', () => {
    const record = detected('https://a.test', [[41, 312]]);
    const url = record.evidence.pages[0]!.url;
    const pages = new Map([[url, { url, final_url: `${url}/` } as PageResult]]);
    const p = compose(builder, record, factsOf(SERVED, pages));
    expect(p.context[1]).toMatch(/^`https:\/\/a\.test\/guides\/g-0\/`: 41 words/);
    expect(p.verify.command).toContain(" 'https://a.test/guides/g-0/' | tr ");
  });

  it('bounds the page lines and says how many it left out; says when every page was rendered', () => {
    const many = detected(
      'https://a.test',
      Array.from({ length: PAGES_SHOWN + 2 }, () => [10, 100] as [number, number]),
    );
    const { context } = compose(builder, many, factsOf());
    expect(context.filter((l) => l.startsWith('`https://'))).toHaveLength(PAGES_SHOWN);
    expect(context).toContain('2 more rendered pages are not shown.');
    expect(context.at(-2)).toBe(
      `Measured by rendering ${PAGES_SHOWN + 2} pages: every graded page of the template.`,
    );
  });

  it('names no URL its record does not hold, and verifies on a rendered page of the record', () => {
    const record = detected('https://a.test', [[41, 312]], 3);
    const p = compose(builder, record, factsOf());
    const commands = [p.verify.command, p.verify.see!.command].map((c) =>
      c.replace(/-A '[^']*'/, ''),
    );
    const urls = [...allText(p), ...commands].flatMap((t) => t.match(/https?:\/\/[^\s`']+/g) ?? []);
    expect(urls.length).toBeGreaterThan(2);
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
    // ssr: false is often there for a reason: the step says what to do when it cannot be removed
    expect(next.change.join('\n')).toMatch(
      /Remove the option if the component can render on the server\. If it cannot, because it uses a browser-only API such as window, leave it as it is and render the content's text in a Server Component placed beside it, not inside it\./,
    );
    // with ssr: false the component is not prerendered, and neither is what is passed into it
    expect(next.change.join('\n')).not.toMatch(/children/);
    const supports = builder.stacks.nextjs!.sources.map((s) => s.supports).join('\n');
    expect(supports).toMatch(/browser-only APIs such as window/);
    expect(supports).toMatch(/ssr: false disables prerendering for a Client Component/);
    expect(supports).not.toMatch(/children/);
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
    expect(served.verify.command).toMatch(/^curl -sSf --compressed -A '[^']*OAI-SearchBot/);
    expect(served.context.join('\n')).not.toMatch(/No tested AI crawler/);
    const none = compose(
      builder,
      record,
      factsOf([{ ua: 'OAI-SearchBot', verdict: 'blocked_by_ua_rule' }]),
    );
    expect(none.verify.ua).toBe(null);
    expect(none.verify.command).toMatch(/^curl -sSf --compressed 'https:\/\/a\.test\/guides\/g-0' \|/);
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
      'Prints its count of the words in the HTML response and exits 0 at 250 or more: 80% of the 312 the audit counted once rendered (it counted 41 without JavaScript). An error status does not pass. The command counts all text outside `script`, `style`, `noscript`, `template`, `svg`, `title`, `nav`, `footer`, `aside` elements: its count differs a little from the audit’s, and a page with that much text outside its main content passes unfixed. The audit’s next check closes the fix sooner: once every rendered page of the template has more than 45% of its rendered words in the HTML response.',
    );
    expect(Math.round(EMPTY_SHELL_LEAVES_ABOVE * 100)).toBe(45);
    // the largest counts a page can have leave the line under the packet's bound
    const big = compose(builder, detected('https://a.test', [[99_999, 999_999]]), factsOf());
    expect(big.verify.expect).not.toMatch(/line cut from/);
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

  it('the readable command prints a rough count: not below the audit’s today, higher by the gained words once fixed', async () => {
    site = await twoStateSite({ broken: html(SHELL), fixed: html(SERVER_RENDERED) });
    const record = measured(site.base);
    const page = record.evidence.pages[0]!;
    const { verify } = compose(builder, record, factsOf());
    expect(verify.see!.command).toMatch(
      new RegExp(
        `^curl -sS --compressed -A '[^']*OAI-SearchBot[^']*' '${page.url}' \\| sed 's/<\\[\\^>\\]\\*>/ /g' \\| wc -w$`,
      ),
    );
    const { broken, fixed } = await inBothStates(site, verify.see!.command);
    const before = Number(broken.stdout);
    const after = Number(fixed.stdout);
    // today: the audit's own count is named, and the rough count is not below it
    expect(verify.see!.today).toBe(
      `The audit counted ${page.raw_words} words in this page’s HTML response. This rough count also takes the text of scripts, styles and menus, which the audit and the exact check leave out, so it is usually higher.`,
    );
    expect(before).toBeGreaterThanOrEqual(page.raw_words);
    // after: higher by about the words the page gains
    expect(verify.see!.after).toBe(
      `A number higher by about the words the page gains: the audit counted ${page.rendered_words} once rendered in a browser, ${page.rendered_words - page.raw_words} more.`,
    );
    expect(Math.abs(after - before - (page.rendered_words - page.raw_words))).toBeLessThanOrEqual(5);
  });

  it('the readable command says one word in the singular, and requests as the exact check does', () => {
    const one = compose(builder, detected('https://a.test', [[1, 2]]), factsOf([])).verify;
    expect(one.see!.today).toMatch(/^The audit counted 1 word in this page’s HTML response\./);
    expect(one.see!.after).toMatch(/counted 2 once rendered in a browser, 1 more\.$/);
    expect(one.see!.command).toBe(
      "curl -sS --compressed 'https://a.test/guides/g-0' | sed 's/<[^>]*>/ /g' | wc -w",
    );
    const url = 'https://a.test/guides/g-0';
    const pages = new Map([
      [url, { url, final_url: 'https://a.test/en/g-0', status_code: 200 } as PageResult],
    ]);
    const moved = compose(builder, detected('https://a.test', [[1, 2]]), factsOf(SERVED, pages));
    expect(moved.verify.see!.command).toContain(" 'https://a.test/en/g-0' | sed ");
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

  it('on a site that redirects the page to its slashed address: the same two states', async () => {
    const at =
      (body: string) =>
      (
        req: { url?: string },
        res: { statusCode: number; setHeader(n: string, v: string): void; end(b: string): void },
      ) => {
        if (req.url?.endsWith('/')) return html(body)(req, res);
        res.statusCode = 301;
        res.setHeader('location', `${req.url}/`);
        res.end('<html><body>Moved</body></html>');
      };
    site = await twoStateSite({ broken: at(SHELL), fixed: at(SERVER_RENDERED) });
    const record = measured(site.base);
    const url = record.evidence.pages[0]!.url;
    const pages = new Map([[url, { url, final_url: `${url}/` } as PageResult]]);
    const { command } = compose(builder, record, factsOf(SERVED, pages)).verify;
    expect(command).toContain(`'${url}/'`);
    const { broken, fixed } = await inBothStates(site, command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    // without the row's served address the command counts the redirect's own body, in both states
    const slashless = compose(builder, record, factsOf()).verify.command;
    expect((await runCommand(slashless)).status).not.toBe(0);
  });

  it('on a site whose page answers 301 to another address: requests the address that answered 200', async () => {
    const at =
      (body: string) =>
      (
        req: { url?: string },
        res: { statusCode: number; setHeader(n: string, v: string): void; end(b: string): void },
      ) => {
        if (req.url === '/en/guides/winter') return html(body)(req, res);
        res.statusCode = 301;
        res.setHeader('location', '/en/guides/winter');
        res.end('<html><body>Moved</body></html>');
      };
    site = await twoStateSite({ broken: at(SHELL), fixed: at(SERVER_RENDERED) });
    const record = measured(site.base);
    const url = record.evidence.pages[0]!.url;
    const landed = `${site.base}/en/guides/winter`;
    const pages = new Map([[url, { url, final_url: landed, status_code: 200 } as PageResult]]);
    const p = compose(builder, record, factsOf(SERVED, pages));
    expect(p.verify.command).toContain(`'${landed}'`);
    // the page keeps its own address where the packet names it
    expect(p.context[1]).toMatch(new RegExp(`^\`${url}\`: `));
    const { broken, fixed } = await inBothStates(site, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    // requested at its own address the command counts the redirect's body, fixed or not
    const own = compose(builder, record, factsOf()).verify.command;
    expect((await runCommand(own)).status).not.toBe(0);
  });

  it('reads a page from a server that gzips whatever the request accepts', async () => {
    const gzipped =
      (body: string) =>
      (_req: unknown, res: { setHeader(n: string, v: string): void; end(b: Buffer): void }) => {
        res.setHeader('content-encoding', 'gzip');
        res.end(gzipSync(body));
      };
    site = await twoStateSite({ broken: gzipped(SHELL), fixed: gzipped(SERVER_RENDERED) });
    const record = measured(site.base);
    const { broken, fixed } = await inBothStates(
      site,
      compose(builder, record, factsOf()).verify.command,
    );
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(Number(fixed.stdout)).toBeGreaterThanOrEqual(wordsNeeded(record.evidence.pages[0]!));
  });

  it('does not pass on an error page that holds the text', async () => {
    site = await twoStateSite({
      broken: html(SHELL),
      fixed: (_req, res) => {
        res.statusCode = 404;
        res.end(SERVER_RENDERED);
      },
    });
    const { verify } = compose(builder, measured(site.base), factsOf());
    site.use('fixed');
    const ran = await runCommand(verify.command);
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).toMatch(/404/);
    expect(verify.expect).toContain('An error status does not pass.');
  });

  it('passes on a server-rendered page with a script closed by `</script >`', async () => {
    const spaced = (page: string) => {
      const out = page.replace('</script>', '</script >').replace('</script>', '</SCRIPT\t>');
      expect(out).not.toBe(page);
      return out;
    };
    site = await twoStateSite({ broken: html(spaced(SHELL)), fixed: html(spaced(SERVER_RENDERED)) });
    const record = measured(site.base);
    const { broken, fixed } = await inBothStates(
      site,
      compose(builder, record, factsOf()).verify.command,
    );
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    // the same counts as with the tags closed plainly
    site.use('broken');
    expect(Math.abs(Number(broken.stdout) - record.evidence.pages[0]!.raw_words)).toBeLessThanOrEqual(5);
  });

  it('does not count commented-out markup, on one line or across tags', async () => {
    const need = wordsNeeded(measured('https://a.test').evidence.pages[0]!);
    const commented = guidePage({
      body: `<!-- ${words(need, 'old')} --><!--<p>${words(need, 'gone')}</p><script>x</script>-->`,
    });
    site = await twoStateSite({
      broken: html(commented),
      fixed: html(SERVER_RENDERED.replace('<main>', '<main><!-- a <b>note</b> --><!---->')),
    });
    const record = measured(site.base);
    const { broken, fixed } = await inBothStates(
      site,
      compose(builder, record, factsOf()).verify.command,
    );
    expect(broken.status).not.toBe(0);
    expect(Math.abs(Number(broken.stdout) - record.evidence.pages[0]!.raw_words)).toBeLessThanOrEqual(
      5,
    );
    expect(fixed.status).toBe(0);
    expect(
      Math.abs(Number(fixed.stdout) - record.evidence.pages[0]!.rendered_words),
    ).toBeLessThanOrEqual(5);
  });

  it('passes on a server-rendered page whose head is not closed', async () => {
    const unclosed = SERVER_RENDERED.replace('</head>', '');
    expect(unclosed).not.toBe(SERVER_RENDERED);
    site = await twoStateSite({
      broken: html(SHELL.replace('</head>', '')),
      fixed: html(unclosed),
    });
    const record = measured(site.base);
    const { broken, fixed } = await inBothStates(
      site,
      compose(builder, record, factsOf()).verify.command,
    );
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(Number(fixed.stdout)).toBeGreaterThanOrEqual(wordsNeeded(record.evidence.pages[0]!));
  });

  it('passes on a server-rendered page whose text is inside a section’s header element', async () => {
    const inHeader = guidePage({ body: `<article><header>${BODY}</header></article>` });
    site = await twoStateSite({ broken: html(SHELL), fixed: html(inHeader) });
    const { broken, fixed } = await inBothStates(
      site,
      compose(builder, measured(site.base), factsOf()).verify.command,
    );
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('the stated limit: an unfixed page with enough static text outside its main content passes', async () => {
    const record0 = measured('https://a.test');
    const need = wordsNeeded(record0.evidence.pages[0]!);
    const menu = `<div class="menu">${words(need, 'menu')}</div>`;
    site = await twoStateSite({
      broken: html(guidePage({ body: '' }).replace('<main>', `${menu}<main>`)),
      fixed: html(SERVER_RENDERED),
    });
    const { verify } = compose(builder, measured(site.base), factsOf());
    expect((await runCommand(verify.command)).status).toBe(0);
    expect(verify.expect).toContain(
      'a page with that much text outside its main content passes unfixed.',
    );
  });

  it('asks for more than the audit needs to close the fix, and says so', () => {
    // the page the command passes is not an empty shell on the next check, whatever it was before
    expect(READABLE_FROM).toBeGreaterThan(EMPTY_SHELL_LEAVES_ABOVE);
    expect(jsTextState(READABLE_FROM, 'empty_shell')).not.toBe('empty_shell');
    expect(jsTextState(EMPTY_SHELL_LEAVES_ABOVE, 'empty_shell')).toBe('empty_shell');
    expect(jsTextState(EMPTY_SHELL_LEAVES_ABOVE + 0.001, 'empty_shell')).not.toBe('empty_shell');
    const { verify } = compose(builder, detected('https://a.test', [[41, 312]]), factsOf());
    expect(verify.expect).toMatch(
      /closes the fix sooner: once every rendered page of the template has more than 45% of its rendered words/,
    );
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
        for (const t of [...allText(p), p.verify.command, p.verify.see!.command]) {
          expect(UNSHOWN.test(t)).toBe(false);
        }
        // the readable command is the same words whatever the site put in its record
        const words = (command: string) => command.replace(/ 'https?:[^']*' \|/, ' URL |');
        expect(words(p.verify.see!.command)).toBe(words(q.verify.see!.command));
      }),
    );
  });
});
