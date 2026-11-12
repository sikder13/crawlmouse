import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { RequestListener } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import fc from 'fast-check';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { commandOf, crawledWord } from './shell.js';
import {
  both,
  canonicalIs,
  command,
  COMMAND_BOUNDS,
  compared,
  fetchOf,
  hreflangHolds,
  httpUrl,
  joined,
  linksTo,
  listed,
  listsDiffer,
  noLinkSays,
  normsOf,
  PAGE_END,
  part,
  sameInCommand,
  spelled,
  type Fragment,
  type HreflangNeeds,
} from './html-checks.js';
import { hostileText, UNSHOWN } from './test-support/hostile.js';
import { pageAt, SPELLINGS } from './test-support/structure.js';
import { runCommand, twoStateSite, type TwoStateSite } from './test-support/verify.js';

let site: TwoStateSite | null = null;
afterEach(async () => {
  await site?.close();
  site = null;
});

const NO_CRAWLER = { crawlers: [], pages: new Map() };

/** A page's HTML, or what makes it from the site's own origin. */
type Html = string | ((base: string) => string);

/** Serves `pages` by path; anything else answers 404. */
async function serving(pages: Record<string, Html>): Promise<TwoStateSite> {
  await site?.close();
  const handler = (req: { url?: string }, res: { statusCode: number; end(b: string): void }) => {
    const html = pages[req.url ?? ''];
    if (html === undefined) res.statusCode = 404;
    res.end(html === undefined ? 'not found' : typeof html === 'string' ? html : html(site!.base));
  };
  site = await twoStateSite({ broken: handler, fixed: handler });
  return site;
}

/** The exit status of the pages at `paths` put through `check`. */
async function status(s: TwoStateSite, paths: string[], check: Fragment): Promise<number> {
  const fetch = fetchOf(
    NO_CRAWLER,
    paths.map((p) => `${s.base}${p}`),
  );
  return (await runCommand(commandOf(command(fetch.fragment, check)))).status;
}

/** Whether `check` passes on each of `pages`, served under its name. */
async function passes(
  pages: Record<string, Html>,
  check: (base: string, path: string) => Fragment,
): Promise<Record<string, boolean>> {
  const s = await serving(
    Object.fromEntries(Object.entries(pages).map(([name, html]) => [`/${name}`, html])),
  );
  const out: Record<string, boolean> = {};
  for (const name of Object.keys(pages)) {
    out[name] = (await status(s, [`/${name}`], check(s.base, `/${name}`))) === 0;
  }
  return out;
}

describe('fetchOf', () => {
  it('requests as the first crawler the site serves, with its published user agent', () => {
    const fetch = fetchOf({ crawlers: [{ ua: 'GPTBot', verdict: 'allowed' }], pages: new Map() }, [
      'https://a.test/x',
    ]);
    expect(fetch.ua).toBe('GPTBot');
    expect(commandOf(command(fetch.fragment))).toMatch(
      /^curl -sS -f --compressed -A '[^']*GPTBot[^']*' 'https:\/\/a\.test\/x'$/,
    );
  });

  it('requests as no crawler when the site serves none, and says so', () => {
    const fetch = fetchOf(
      { crawlers: [{ ua: 'GPTBot', verdict: 'blocked_by_ua_rule' }], pages: new Map() },
      ['https://a.test/x'],
    );
    expect(fetch.ua).toBeNull();
    expect(commandOf(command(fetch.fragment))).toBe("curl -sS -f --compressed 'https://a.test/x'");
  });

  it('requests each page at the address it is served at, and marks the end of each when it fetches two', () => {
    const pages = new Map([
      ['https://a.test/p', pageAt('https://a.test/p', { final_url: 'https://a.test/p/' })],
      ['https://a.test/q', pageAt('https://a.test/q', { final_url: 'https://a.test/elsewhere' })],
    ]);
    const fetch = fetchOf({ crawlers: [], pages }, ['https://a.test/p', 'https://a.test/q']);
    expect(commandOf(command(fetch.fragment))).toBe(
      `curl -sS -f --compressed -w '\\n${PAGE_END}\\n' 'https://a.test/p/' 'https://a.test/elsewhere'`,
    );
  });
});

describe('httpUrl', () => {
  it('spells an http or https URL as the engine does, and refuses anything else', () => {
    expect(httpUrl('https://A.test/p/?b=2&a=1')).toBe('https://a.test/p?a=1&b=2');
    for (const not of ['http://', '//', 'http://[', 'https://exa mple.com/x', 'mailto:a@b', '']) {
      expect(httpUrl(not), not).toBeNull();
      expect(spelled(not), not).toBe(not);
    }
    expect(httpUrl(`https://a.test/${'a'.repeat(COMMAND_BOUNDS.url_chars)}`)).toBeNull();
  });
});

describe('listed', () => {
  it('keeps up to the count and up to the characters a command lists', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://a.test/${'u'.repeat(2000)}${i}`);
    const wordOf = (u: string) => crawledWord(u, 4000);
    expect(listed(urls, 3, wordOf)).toEqual(urls.slice(0, 3));
    const kept = listed(urls, 12, wordOf);
    expect(kept).toEqual(urls.slice(0, 4));
    expect(urls.slice(0, 5).join('').length).toBeGreaterThan(COMMAND_BOUNDS.listed_chars);
  });
});

describe('linksTo', () => {
  const to = (target: string) => (base: string, path: string) =>
    linksTo(`${base}${path}`, [`${base}${target}`]);

  it('finds a link however the page writes it', async () => {
    expect(
      await passes(
        {
          root: '<a href="/t">x</a>',
          full: (base) => `<a href="${base}/t/">x</a>`,
          query: '<a href="/t?a=1&amp;b=2">x</a><a href="/t">x</a>',
          slashed: '<a href="/t/">x</a>',
          single: "<a class='x' href='/t'>x</a>",
          unquoted: '<a href=/t>x</a>',
          upper: '<A HREF="/t">x</A>',
          lines: '<a\n   class="x"\n   href="/t"\n>x</a>',
          fragment: '<a href="/t#top">x</a>',
          spaced: '<a href = "/t">x</a>',
        },
        to('/t'),
      ),
    ).toEqual({
      root: true,
      full: true,
      query: true,
      slashed: true,
      single: true,
      unquoted: true,
      upper: true,
      lines: true,
      fragment: true,
      spaced: true,
    });
  });

  it('reads a query with its ampersands entity-encoded, and tells another host apart', async () => {
    const pages = {
      query: '<a href="/t?a=1&amp;b=2">x</a>',
      otherHost: '<a href="https://other.test/t?a=1&b=2">x</a>',
      otherOrder: '<a href="/t?b=2&a=1">x</a>',
      otherValue: '<a href="/t?a=1&b=3">x</a>',
      oneMore: '<a href="/t?a=1&b=2&c=3">x</a>',
      emptyPairs: '<a href="/t?&a=1&&b=2&">x</a>',
    };
    expect(await passes(pages, to('/t?a=1&b=2'))).toEqual({
      query: true,
      otherHost: false,
      otherOrder: true,
      otherValue: false,
      oneMore: false,
      emptyPairs: true,
    });
  });

  it('reads no link from a comment, a script, a style, a template, a textarea or another attribute', async () => {
    expect(
      await passes(
        {
          comment: '<!-- <a href="/t">x</a> -->',
          script: `<script>var nav='<a href="/t">x</a>'</script>`,
          scriptAttrs: `<SCRIPT type="text/template"><a href="/t">x</a></SCRIPT>`,
          style: '<style><a href="/t">x</a></style>',
          template: '<template><a href="/t">x</a></template>',
          textarea: '<textarea><a href="/t">x</a></textarea>',
          unclosed: '<p>text</p><!-- <a href="/t">x</a>',
          data: '<a data-href="/t" href="/u">x</a>',
          area: '<area href="/t">',
          longer: '<a href="/tt">x</a>',
          afterComment: '<!-- old --><a href="/t">x</a><!-- <a href="/u">y</a> -->',
          afterScript: '<script>1</script><a href="/t">x</a><script>2</script>',
        },
        to('/t'),
      ),
    ).toEqual({
      comment: false,
      script: false,
      scriptAttrs: false,
      style: false,
      template: false,
      textarea: false,
      unclosed: false,
      data: false,
      area: false,
      longer: false,
      afterComment: true,
      afterScript: true,
    });
  });

  it('keeps the root path and the origin as one target', async () => {
    const s = await serving({ '/p': '<a href="/">home</a>', '/q': '<a href="/x">x</a>' });
    expect(await status(s, ['/p'], linksTo(`${s.base}/p`, [s.base]))).toBe(0);
    expect(await status(s, ['/p'], linksTo(`${s.base}/p`, [`${s.base}/?a=1`]))).not.toBe(0);
    expect(await status(s, ['/q'], linksTo(`${s.base}/q`, [s.base]))).not.toBe(0);
    expect(await status(s, ['/missing'], linksTo(`${s.base}/missing`, [s.base]))).not.toBe(0);
  });

  it('passes on the new target only when the old one is gone', async () => {
    const moved = (base: string, path: string) =>
      linksTo(`${base}${path}`, [`${base}/new-url`], [`${base}/old-url`]);
    expect(
      await passes(
        {
          old: '<a href="/old-url">x</a>',
          both: '<a href="/old-url">x</a><a href="/new-url">y</a>',
          bothSlashed: '<a href="/old-url/">x</a><a href="/new-url">y</a>',
          oldCommented: '<!-- <a href="/old-url">x</a> --><a href="/new-url">y</a>',
          new: '<a href="/new-url">y</a>',
          neither: '<a href="/else">y</a>',
        },
        moved,
      ),
    ).toEqual({
      old: false,
      both: false,
      bothSlashed: false,
      oldCommented: true,
      new: true,
      neither: false,
    });
  });

  it.each(SPELLINGS)(
    'finds a stale link whose URL holds %s, however the page spells it',
    async (_name, recorded, written) => {
      const s = await serving({
        ...Object.fromEntries(
          written.map((a, i) => [`/broken${i}`, `${a}<a href="/womens">y</a>`]),
        ),
        '/fixed': '<a href="/womens">y</a>',
      });
      const check = (path: string) =>
        status(
          s,
          [path],
          linksTo(`${s.base}${path}`, [`${s.base}/womens`], [`${s.base}${recorded}`]),
        );
      for (const i of written.keys()) expect(await check(`/broken${i}`), written[i]).not.toBe(0);
      expect(await check('/fixed')).toBe(0);
    },
  );

  it.each(SPELLINGS)(
    'finds a link to a URL that holds %s, however the page spells it',
    async (_name, recorded, written) => {
      const s = await serving(Object.fromEntries(written.map((a, i) => [`/p${i}`, a])));
      for (const i of written.keys()) {
        const path = `/p${i}`;
        expect(
          await status(s, [path], linksTo(`${s.base}${path}`, [`${s.base}${recorded}`])),
          written[i],
        ).toBe(0);
      }
    },
  );
});

describe('linksTo, against the ways a page can spell a URL', () => {
  /**
   * Each href is a link to /old on a page at /dir/page, as the engine's reader records it (round 2,
   * correctness finding 3, and SEO finding 6): `{base}` is the site's origin, `{host}` its host.
   */
  const OLD: [name: string, anchor: string][] = [
    ['root-relative', '<a href="/old">x</a>'],
    ['document-relative', '<a href="../old">x</a>'],
    ['document-relative with a dot', '<a href="./../old">x</a>'],
    ['protocol-relative', '<a href="//{host}/old">x</a>'],
    ['an upper-case scheme and host', '<a href="HTTP://{HOST}/old">x</a>'],
    ['a dot segment', '<a href="/./old">x</a>'],
    ['two dots', '<a href="/a/../old">x</a>'],
    ['an escaped dot segment', '<a href="/a/%2E%2e/old">x</a>'],
    ['an empty query', '<a href="/old?">x</a>'],
    ['a numeric character reference', '<a href="/ol&#100;">x</a>'],
    ['a hex character reference', '<a href="/ol&#x64;">x</a>'],
    ['a backslash', '<a href="\\old">x</a>'],
    ['a > inside another attribute', '<a title="a>b" href="/old">x</a>'],
    ['an href inside another attribute first', `<a title=' href="/new" ' href="/old">x</a>`],
    ['the scheme alone before a path', '<a href="http:/old">x</a>'],
    ['a doubled slash', '<a href="//{host}//old">x</a>'],
    ['a tab in the tag', '<a\thref="/old">x</a>'],
  ];
  const at = (base: string, html: string) => {
    const { host } = new URL(base);
    return html.replaceAll('{HOST}', host.toUpperCase()).replaceAll('{host}', host);
  };

  it.each(OLD)('finds the stale link written with %s', async (_name, anchor) => {
    const kept = '<a href="/new">y</a>';
    const s = await serving({
      '/dir/page': (base) => at(base, `${anchor}${kept}`),
      '/dir/fixed': kept,
    });
    const check = (path: string) =>
      status(s, [path], linksTo(`${s.base}${path}`, [`${s.base}/new`], [`${s.base}/old`]));
    expect(await check('/dir/page')).not.toBe(0);
    expect(await check('/dir/fixed')).toBe(0);
  });

  it.each(OLD)('finds the link it asks for written with %s', async (_name, anchor) => {
    const s = await serving({
      '/dir/page': (base) => at(base, anchor),
      '/dir/other': '<a href="/older">x</a>',
    });
    const check = (path: string) =>
      status(s, [path], linksTo(`${s.base}${path}`, [`${s.base}/old`]));
    expect(await check('/dir/page')).toBe(0);
    expect(await check('/dir/other')).not.toBe(0);
  });

  it('counts an href it cannot read as the stale link, and only when a stale link is asked about', async () => {
    const s = await serving({ '/p': '<a href="/ol&dscr;">x</a><a href="/new">y</a>' });
    const page = `${s.base}/p`;
    expect(await status(s, ['/p'], linksTo(page, [`${s.base}/new`], [`${s.base}/old`]))).not.toBe(
      0,
    );
    expect(await status(s, ['/p'], linksTo(page, [`${s.base}/new`]))).toBe(0);
  });

  // round 2, security finding 4: an escaped delimiter is not the delimiter
  it('keeps apart two URLs that differ by an escaped slash, question mark, hash or percent', async () => {
    const pages = {
      slash: '<a href="/a%2Fb">x</a>',
      question: '<a href="/a%3Fb">x</a>',
      hash: '<a href="/a%23b">x</a>',
      percent: '<a href="/a%2541">x</a>',
      ampersand: '<a href="/q?a=1%26b=2">x</a>',
    };
    const links = (target: string) => async (name: keyof typeof pages) =>
      (
        await passes({ [name]: pages[name] }, (base, path) =>
          linksTo(`${base}${path}`, [`${base}${target}`]),
        )
      )[name];
    expect(await links('/a/b')('slash')).toBe(false);
    expect(await links('/a%2Fb')('slash')).toBe(true);
    expect(await links('/a%2fb')('slash')).toBe(true);
    expect(await links('/a?b')('question')).toBe(false);
    expect(await links('/a%3Fb')('question')).toBe(true);
    expect(await links('/a')('hash')).toBe(false);
    expect(await links('/aA')('percent')).toBe(false);
    expect(await links('/q?a=1&b=2')('ampersand')).toBe(false);
  });

  it('resolves a relative link against the first <base href>, as a browser does', async () => {
    const pages = {
      otherSite: '<base href="https://other.test/"><a href="/t">x</a>',
      otherSiteRelative: '<head><base href="https://other.test/"></head><a href="t">x</a>',
      otherSiteFull: (base: string) => `<base href="https://other.test/"><a href="${base}/t">x</a>`,
      toRoot: '<base href="/"><a href="t">x</a>',
      toDirectory: '<base href="/shop/"><a href="../t">x</a>',
      secondIgnored: '<base href="/"><base href="/shop/"><a href="t">x</a>',
      none: '<a href="t">x</a>',
    };
    const s = await serving(
      Object.fromEntries(Object.entries(pages).map(([name, html]) => [`/dir/${name}`, html])),
    );
    const out: Record<string, boolean> = {};
    for (const name of Object.keys(pages)) {
      const path = `/dir/${name}`;
      out[name] = (await status(s, [path], linksTo(`${s.base}${path}`, [`${s.base}/t`]))) === 0;
    }
    expect(out).toEqual({
      otherSite: false,
      otherSiteRelative: false,
      otherSiteFull: true,
      toRoot: true,
      toDirectory: true,
      secondIgnored: true,
      none: false,
    });
  });

  it('reads past a script that ends with a space in its end tag, and stops at a tag that never ends', async () => {
    expect(
      await passes(
        {
          spacedEnd: '<script>var a = "<a href=/u>";</script ><a href="/t">x</a>',
          upperEnd: '<script>1</SCRIPT\n><a href="/t">x</a>',
          inScript: '<script>var a = \'<a href="/t">x</a>\';</script >',
          openQuote: `<a href="/t">x</a><p title="${'<i>x</i>'.repeat(12)}`,
          declaration: '<!DOCTYPE html><?xml version="1.0"?><a href="/t">x</a>',
          emptyComment: '<!--><a href="/t">x</a><!--->',
          lessThan: '<p>1 < 2 and a<b</p><a href="/t">x</a>',
        },
        (base, path) => linksTo(`${base}${path}`, [`${base}/t`]),
      ),
    ).toEqual({
      spacedEnd: true,
      upperEnd: true,
      inScript: false,
      openQuote: false,
      declaration: true,
      emptyComment: true,
      lessThan: true,
    });
  });
});

describe('sameInCommand', () => {
  it('says when the programs cannot tell two URLs of a record apart', () => {
    // round 2, security finding 4: the engine keeps these apart, and `norm` decodes both to one
    expect(sameInCommand('https://a.test/x%7Ey', 'https://a.test/x~y')).toBe(true);
    expect(sameInCommand('https://a.test/a?x=1&y=2', 'https://a.test/a?y=2&x=1')).toBe(true);
    expect(sameInCommand('https://a.test/a//b/', 'https://a.test/a/b')).toBe(true);
    expect(sameInCommand('https://a.test/a/b', 'https://a.test/a%2Fb')).toBe(false);
    expect(sameInCommand('https://a.test/a?b', 'https://a.test/a%3Fb')).toBe(false);
    expect(sameInCommand('https://a.test/old', 'https://a.test/new')).toBe(false);
    expect(sameInCommand('http://a.test:80/x', 'http://A.TEST/x/')).toBe(true);
    expect(sameInCommand('not a url', 'not a url')).toBe(false);
  });

  it('compares as the awk programs do (property)', async () => {
    const piece = fc.constantFrom(
      'a',
      'b',
      'A',
      '/',
      '//',
      '.',
      '%2F',
      '%2f',
      '%7E',
      '~',
      '%41',
      '%25',
      '%C3%A9',
      'é',
      '+',
      '%2B',
      '%20',
      ' ',
      '&',
      '=',
      '?',
      '%3F',
      '%26',
      '%3D',
      '%00',
      '%',
      '%zz',
      "'",
      '[1]',
      '{x}',
    );
    const urlArb = fc
      .tuple(
        fc.constantFrom('https://a.test', 'http://A.test:80', 'https://a.test:8443'),
        fc.array(piece, { maxLength: 6 }),
        fc.option(fc.array(piece, { maxLength: 6 }), { nil: null }),
      )
      .map(([origin, path, query]) =>
        `${origin}/${path.join('')}${query === null ? '' : `?${query.join('')}`}`.replaceAll(
          '#',
          '',
        ),
      )
      .filter((u) => URL.canParse(u));
    await fc.assert(
      fc.asyncProperty(fc.array(urlArb, { minLength: 2, maxLength: 12 }), async (urls) => {
        const byAwk = (
          await new Promise<Buffer>((resolve, reject) =>
            execFile(
              'sh',
              ['-c', commandOf(normsOf(urls))],
              { encoding: 'buffer' },
              (error, out) => (error ? reject(error) : resolve(out)),
            ),
          )
        )
          .toString('latin1')
          .split('\n')
          .slice(0, -1);
        expect(byAwk).toEqual(urls.map((u) => compared(new URL(u).href)));
      }),
      { numRuns: 60, seed: 30 },
    );
  });
});

describe('what the request asks of the server', () => {
  it('does not pass on an error page that carries the tag', async () => {
    const html = '<html><head><link rel="canonical" href="/gone"></head><a href="/t">x</a></html>';
    site = await twoStateSite({
      broken: (_req, res) => void res.writeHead(404, { 'content-type': 'text/html' }).end(html),
      fixed: (_req, res) => void res.writeHead(200, { 'content-type': 'text/html' }).end(html),
    });
    const page = `${site.base}/gone`;
    for (const check of [canonicalIs(page, page), linksTo(page, [`${site.base}/t`])]) {
      const run = commandOf(command(fetchOf(NO_CRAWLER, [page]).fragment, check));
      site.use('broken');
      expect((await runCommand(run)).status).not.toBe(0);
      site.use('fixed');
      expect((await runCommand(run)).status).toBe(0);
    }
  });

  it('reads a page from a server that compresses every response', async () => {
    const body = gzipSync('<a href="/t">x</a>');
    const zipped: RequestListener = (_req, res) =>
      void res
        .writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
        .end(body);
    site = await twoStateSite({ broken: zipped, fixed: zipped });
    const page = `${site.base}/p`;
    const run = commandOf(
      command(fetchOf(NO_CRAWLER, [page]).fragment, linksTo(page, [`${site.base}/t`])),
    );
    expect((await runCommand(run)).status).toBe(0);
  });

  it('reads a page of two megabytes within the time a command is given', async () => {
    const big =
      '<html><head><link rel="canonical" href="/big"></head><body>' +
      Array.from(
        { length: 6000 },
        (_, i) =>
          `<!-- c${i} --><div class="row"><a href="/item/${i}" title="a>b">Item ${i} ${'x'.repeat(250)}</a>\n</div><script>var a${i} = "<a href=/no>";</script>`,
      ).join('') +
      '<a href="/t">read more</a></body></html>';
    expect(big.length).toBeGreaterThan(2_000_000);
    const s = await serving({ '/big': big });
    const page = `${s.base}/big`;
    const started = Date.now();
    expect(await status(s, ['/big'], linksTo(page, [`${s.base}/t`], [`${s.base}/no`]))).toBe(0);
    expect(await status(s, ['/big'], canonicalIs(page, page))).toBe(0);
    expect(await status(s, ['/big'], noLinkSays(page, [crawledWord('read more')]))).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe('canonicalIs', () => {
  const is = (target: string) => (base: string, path: string) =>
    canonicalIs(`${base}${path}`, `${base}${target}`);
  const head = (inner: string, body = '') =>
    `<html><head>${inner}</head><body>${body}</body></html>`;
  const tag = (href: string) => `<link rel="canonical" href="${href}">`;

  it('passes on one canonical in the head that names the URL, however it is written', async () => {
    expect(
      await passes(
        {
          plain: head(tag('/c')),
          full: (base) => head(tag(`${base}/c/`)),
          slashed: head(tag('/c/')),
          hrefFirst: head(`<LINK HREF='/c' REL='Canonical'/>`),
          unquoted: head('<link rel=canonical href=/c>'),
          oldCommented: head(`<!-- ${tag('/old')} -->${tag('/c')}`),
          noHeadEnd: `<html><head><title>t</title><meta charset="utf-8">${tag('/c')}<body><p>x</p></body></html>`,
          noHeadTags: `<!doctype html><title>t</title>${tag('/c')}<p>x</p>`,
          inNoscript: head(`<noscript>${tag('/c')}</noscript>`),
          afterScript: head(`<script>var a = "<p>";</script><style>p{}</style>${tag('/c')}`),
        },
        is('/c'),
      ),
    ).toEqual({
      plain: true,
      full: true,
      slashed: true,
      hrefFirst: true,
      unquoted: true,
      oldCommented: true,
      noHeadEnd: true,
      noHeadTags: true,
      inNoscript: true,
      afterScript: true,
    });
  });

  it('fails on two canonicals, one in the body, one commented out, another URL, or none', async () => {
    expect(
      await passes(
        {
          twoConflicting: head(`${tag('/c')}${tag('/old')}`),
          twoSame: head(`${tag('/c')}${tag('/c')}`),
          inBody: head('', tag('/c')),
          afterBodyContent: `<html><p>x</p>${tag('/c')}</html>`,
          onlyCommented: head(`<!-- ${tag('/c')} -->`),
          inScript: head(`<script>document.write('${tag('/c')}')</script>`),
          other: head(tag('/old')),
          none: head('<link rel="alternate" href="/c">'),
          relList: head('<link rel="canonical nofollow" href="/c">'),
        },
        is('/c'),
      ),
    ).toEqual({
      twoConflicting: false,
      twoSame: false,
      inBody: false,
      afterBodyContent: false,
      onlyCommented: false,
      inScript: false,
      other: false,
      none: false,
      relList: false,
    });
  });
});

describe('hreflangHolds', () => {
  const links = (pairs: [string, string][]) =>
    pairs.map(([l, h]) => `<link rel="alternate" hreflang="${l}" href="${h}">`).join('');
  const head = (pairs: [string, string][]) =>
    `<html><head>${links(pairs)}</head><body></body></html>`;
  const needs =
    (over: (base: string) => Partial<HreflangNeeds> = () => ({})) =>
    (base: string, path: string) =>
      hreflangHolds({
        self: `${base}${path}`,
        fallback: false,
        must: [],
        goneValues: [],
        goneUrls: [],
        ...over(base),
      });

  it('asks for the page under a language code, each return and nothing gone', async () => {
    const s = await serving({
      '/ok': head([
        ['en', '/ok'],
        ['de', '/de/'],
        ['x-default', '/ok'],
      ]),
      '/no-self': head([
        ['de', '/de'],
        ['x-default', '/no-self'],
      ]),
    });
    const run = (path: string, over: Partial<HreflangNeeds>) =>
      status(s, [path], needs(() => over)(s.base, path));
    expect(await run('/ok', { must: [`${s.base}/de`], goneValues: [crawledWord('en-UK')] })).toBe(
      0,
    );
    expect(await run('/ok', { must: [`${s.base}/fr`] })).not.toBe(0);
    expect(await run('/ok', { goneUrls: [`${s.base}/de`] })).not.toBe(0);
    expect(await run('/ok', { goneValues: [crawledWord('de')] })).not.toBe(0);
    expect(await run('/no-self', {})).not.toBe(0);
    expect(await run('/missing', {})).not.toBe(0);
  });

  it('asks for an x-default only when told to', async () => {
    const pages = {
      without: head([
        ['en', '/without'],
        ['de', '/de'],
      ]),
      with: head([
        ['en', '/with'],
        ['X-Default', '/with'],
      ]),
    };
    expect(await passes(pages, needs())).toEqual({ without: true, with: true });
    expect(
      await passes(
        pages,
        needs(() => ({ fallback: true })),
      ),
    ).toEqual({
      without: false,
      with: true,
    });
  });

  it('reads the annotations a search engine reads, and no others', async () => {
    const own = (name: string): [string, string][] => [
      ['en', `/${name}`],
      ['de', '/de'],
    ];
    expect(
      await passes(
        {
          upper: `<head><LINK REL="Alternate" HREFLANG="en" HREF="/upper"></head>`,
          single: `<head><link href='/single' hreflang='en-GB' rel='alternate'></head>`,
          script: `<head><link rel="alternate" hreflang="zh-Hant-TW" href="/script"></head>`,
          commented: `<html><head><!-- ${links(own('commented'))} --></head></html>`,
          inBody: `<html><head></head><body>${links(own('inBody'))}</body></html>`,
          garbage: head([
            ['english', '/garbage'],
            ['x-default', '/dead'],
          ]),
          oneGarbage: head([
            ['en', '/oneGarbage'],
            ['en_US', '/us'],
          ]),
          regionOnly: head([['uk-', '/regionOnly']]),
          notAlternate: `<head><link rel="stylesheet" hreflang="en" href="/notAlternate"></head>`,
        },
        needs(),
      ),
    ).toEqual({
      upper: true,
      single: true,
      script: true,
      commented: false,
      inBody: false,
      garbage: false,
      oneGarbage: false,
      regionOnly: false,
      notAlternate: false,
    });
  });
});

describe('noLinkSays', () => {
  const check = (base: string, path: string) =>
    noLinkSays(`${base}${path}`, [crawledWord('Click here'), crawledWord('read more')]);

  it('passes when the page has links and the first text for each target is not a listed one', async () => {
    expect(
      await passes(
        {
          generic: '<a href="/a">CLICK HERE</a><a href="/b">Ridge tent</a>',
          nested: '<a href="/a"><span> Read\n <b>more</b></span></a>',
          nbsp: '<a href="/a">Read&nbsp;more</a>',
          nbspRaw: '<a href="/a">Read more</a>',
          named: '<a href="/a">Ridge footprint</a><a href="/b">Ridge tent</a>',
          secondGeneric: '<a href="/a">Ridge footprint</a><a href="/a/">Read more</a>',
          firstGeneric: '<a href="/a">Read more</a><a href="/a">Ridge footprint</a>',
          commented: '<!-- <a href="/a">Read more</a> --><a href="/a">Ridge footprint</a>',
          otherPhrase: '<a href="/a">Read more »</a><a href="/b">Learn more</a>',
          empty: '<p>no links</p>',
          noHref: '<a name="x">Ridge tent</a>',
        },
        check,
      ),
    ).toEqual({
      generic: false,
      nested: false,
      nbsp: false,
      nbspRaw: false,
      named: true,
      secondGeneric: true,
      firstGeneric: false,
      commented: true,
      otherPhrase: true,
      empty: false,
      noHref: false,
    });
  });
});

describe('listsDiffer', () => {
  const nav = '<a href="/list">1</a><a href="/list?page=2">2</a><a href="/list?page=3">3</a>';
  const items = (...ids: number[]) => ids.map((i) => `<a href="/item/${i}">item ${i}</a>`).join('');

  it('passes when each page has a link of its own that is not the list itself', async () => {
    const s = await serving({
      '/list': `${nav}${items(1, 2)}`,
      '/repeat': `${nav}${items(1, 2)}`,
      '/repeat-and-sort': `${nav}${items(1, 2)}<a href="/list?sort=price">sort</a>`,
      '/repeat-and-unrelated': `${nav}${items(1, 2)}<a href="/about">about</a>`,
      '/repeat-and-list-link': `${nav}${items(1, 2)}<a href="/list?page=4">4</a>`,
      '/subset': `${nav}${items(1)}`,
      '/own': `${nav}${items(3, 4)}`,
      '/own-last': `${nav}${items(5)}`,
    });
    const run = (later: string) =>
      status(
        s,
        ['/list', later],
        listsDiffer(`${s.base}/list`, `${s.base}${later}`, crawledWord('page=')),
      );
    expect(await run('/repeat')).not.toBe(0);
    expect(await run('/repeat-and-sort')).not.toBe(0);
    expect(await run('/repeat-and-unrelated')).not.toBe(0);
    expect(await run('/repeat-and-list-link')).not.toBe(0);
    expect(await run('/subset')).not.toBe(0);
    expect(await run('/missing')).not.toBe(0);
    expect(await run('/own')).toBe(0);
    expect(await run('/own-last')).toBe(0);
  });
});

describe('both', () => {
  it('passes when each command passes', async () => {
    const s = await serving({ '/p': '<a href="/t">x</a>' });
    const one = (target: string) =>
      joined(fetchOf(NO_CRAWLER, [`${s.base}/p`]).fragment, linksTo(`${s.base}/p`, [target]));
    const run = async (a: string, b: string) =>
      (await runCommand(commandOf(command(both(one(a), one(b)))))).status;
    expect(await run(`${s.base}/t`, `${s.base}/t`)).toBe(0);
    expect(await run(`${s.base}/t`, `${s.base}/u`)).not.toBe(0);
    expect(await run(`${s.base}/u`, `${s.base}/t`)).not.toBe(0);
  });
});

describe('a command over hostile values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'packets-html-checks-'));
  const marker = join(dir, 'ran');
  afterEach(() => rmSync(marker, { force: true }));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const hostile = fc
    .tuple(
      hostileText(4),
      fc.constantFrom(`$(touch ${marker})`, `'; touch ${marker}; '`, `\`touch ${marker}\``),
    )
    .map(([a, b]) => `${a}${b}${a}`);

  it('is one line with nothing unshown in it, and runs nothing a value holds', async () => {
    await fc.assert(
      fc.asyncProperty(hostile, hostile, async (path, text) => {
        const target = new URL(
          `http://127.0.0.1:9/${encodeURIComponent(path)}?q=${encodeURIComponent(text)}`,
        ).href;
        const page = part`printf '<a href="/x">y</a>'`;
        const built = commandOf(
          command(
            page,
            linksTo(target, [target], [target]),
            part` ; `,
            page,
            canonicalIs(target, target),
            part` ; `,
            page,
            noLinkSays(target, [crawledWord(text), crawledWord(path)]),
            part` ; `,
            page,
            hreflangHolds({
              self: target,
              fallback: true,
              must: [target],
              goneValues: [crawledWord(text), crawledWord(path)],
              goneUrls: [target],
            }),
            part` ; `,
            page,
            listsDiffer(target, target, crawledWord(text)),
          ),
        );
        expect(built).not.toMatch(/[\r\n]/);
        expect(UNSHOWN.test(built)).toBe(false);
        await runCommand(built);
        expect(existsSync(marker)).toBe(false);
      }),
      { numRuns: 40 },
    );
  });
});
