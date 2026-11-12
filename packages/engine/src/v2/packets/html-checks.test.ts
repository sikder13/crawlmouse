import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { commandOf, crawledWord } from './shell.js';
import {
  ANCHOR_HREFS,
  ANCHOR_TEXTS,
  anyOf,
  both,
  CANONICAL_HREF,
  command,
  fetchOf,
  hreflangHolds,
  HREFLANG_PAIRS,
  hrefForms,
  linksBeyondFirst,
  movedTo,
  noneOf,
  PAGE_END,
  part,
  type Fragment,
} from './html-checks.js';
import { hostileText, UNSHOWN } from './test-support/hostile.js';
import { runCommand, twoStateSite, type TwoStateSite } from './test-support/verify.js';

let site: TwoStateSite | null = null;
afterEach(async () => {
  await site?.close();
  site = null;
});

const NO_CRAWLER = { crawlers: [] };

/** Serves `pages` by path; anything else answers 404. */
async function serving(pages: Record<string, string>): Promise<TwoStateSite> {
  const handler = (req: { url?: string }, res: { statusCode: number; end(b: string): void }) => {
    const body = pages[req.url ?? ''];
    if (body === undefined) res.statusCode = 404;
    res.end(body ?? 'not found');
  };
  site = await twoStateSite({ broken: handler, fixed: handler });
  return site;
}

/** The lines a pipeline gives for the page at `path`. */
async function lines(s: TwoStateSite, path: string, pipeline: Fragment): Promise<string[]> {
  const out = await runCommand(
    commandOf(command(fetchOf(NO_CRAWLER, [`${s.base}${path}`]).fragment, pipeline)),
  );
  return out.stdout.split('\n').filter((l) => l !== '');
}

/** The exit status of the page at `path` put through `pipeline` then `last`. */
async function status(s: TwoStateSite, paths: string[], ...rest: Fragment[]): Promise<number> {
  const fetch = fetchOf(
    NO_CRAWLER,
    paths.map((p) => `${s.base}${p}`),
  );
  return (await runCommand(commandOf(command(fetch.fragment, ...rest)))).status;
}

describe('fetchOf', () => {
  it('requests as the first crawler the site serves, with its published user agent', () => {
    const fetch = fetchOf({ crawlers: [{ ua: 'GPTBot', verdict: 'allowed' }] }, [
      'https://a.test/x',
    ]);
    expect(fetch.ua).toBe('GPTBot');
    expect(commandOf(command(fetch.fragment))).toMatch(
      /^curl -sS -A '[^']*GPTBot[^']*' 'https:\/\/a\.test\/x'$/,
    );
  });

  it('requests as no crawler when the site serves none, and says so', () => {
    const fetch = fetchOf({ crawlers: [{ ua: 'GPTBot', verdict: 'blocked_by_ua_rule' }] }, [
      'https://a.test/x',
    ]);
    expect(fetch.ua).toBeNull();
    expect(commandOf(command(fetch.fragment))).toBe("curl -sS 'https://a.test/x'");
  });

  it('marks the end of each page when it fetches two, with the mark the pipeline reads', () => {
    const fetch = fetchOf(NO_CRAWLER, ['https://a.test/l', 'https://a.test/l?page=2']);
    expect(commandOf(command(fetch.fragment))).toBe(
      `curl -sS -w '<a href="${PAGE_END}">' 'https://a.test/l' 'https://a.test/l?page=2'`,
    );
    expect(commandOf(command(linksBeyondFirst(crawledWord('page='), [])))).toContain(
      `$0 == "${PAGE_END}"`,
    );
  });
});

describe('the pipelines, on HTML as sites write it', () => {
  it('reads the target of each anchor, in either quote, across lines, and of nothing else', async () => {
    const s = await serving({
      '/p': `<html><head><link rel="stylesheet" href="/style.css"></head><body>
        <a href="/double">a</a> <a class='x' href='/single/'>b</a>
        <a
           href="https://a.test/abs?x=1&amp;y=2#top">c</a>
        <A HREF="/upper">d</A> <a data-href="/data" href="/real">e</a>
        <area href="/area"> <a name="top">f</a></body></html>`,
    });
    expect(await lines(s, '/p', ANCHOR_HREFS)).toEqual([
      '/double',
      '/single',
      'https://a.test/abs?x=1&y=2',
      '/upper',
      '/real',
    ]);
  });

  it('keeps the root path and an origin as their own spellings', async () => {
    const s = await serving({ '/p': '<a href="/">home</a> <a href="https://a.test/">home</a>' });
    expect(await lines(s, '/p', ANCHOR_HREFS)).toEqual(['/', 'https://a.test']);
  });

  it('reads the first canonical, with rel before or after href', async () => {
    const s = await serving({
      '/a': '<head><link rel="canonical" href="https://a.test/a/"><link rel="canonical" href="/b"></head>',
      '/b': "<head><link href='/b' rel='canonical'></head>",
      '/c': '<head><link rel="alternate" href="/x"></head>',
    });
    expect(await lines(s, '/a', CANONICAL_HREF)).toEqual(['https://a.test/a']);
    expect(await lines(s, '/b', CANONICAL_HREF)).toEqual(['/b']);
    expect(await lines(s, '/c', CANONICAL_HREF)).toEqual([]);
  });

  it('reads each hreflang annotation as its value and its target, in either attribute order', async () => {
    const s = await serving({
      '/p': `<head><link rel="alternate" hreflang="en" href="https://a.test/en/">
        <link href="https://a.test/de" hreflang="de" rel="alternate">
        <link rel="alternate" hreflang="x-default" href="https://a.test/"></head>`,
    });
    expect(await lines(s, '/p', HREFLANG_PAIRS)).toEqual([
      'en https://a.test/en',
      'de https://a.test/de',
      'x-default https://a.test',
    ]);
  });

  it('reads the text of each anchor, without the tags inside it and with spaces collapsed', async () => {
    const s = await serving({
      '/p': `<a href="/a">Click   here</a><a href="/b"><span> Read
        <b>more</b></span></a><a href="/c">Ridge&nbsp;tent</a><a href="/d"><img src="x"></a>`,
    });
    expect(await lines(s, '/p', ANCHOR_TEXTS)).toEqual(['Click here', 'Read more', 'Ridge tent']);
  });
});

describe('the last stages', () => {
  it('anyOf passes when the page links to the target, in full or from the root', async () => {
    const s = await serving({
      '/root': '<a href="/t">x</a>',
      '/full': `<a href='https://a.test/t/'>x</a>`,
      '/none': '<a href="/tt">x</a><a href="/other">y</a>',
    });
    const linked = [ANCHOR_HREFS, anyOf(hrefForms('https://a.test/t'))];
    expect(await status(s, ['/root'], ...linked)).toBe(0);
    expect(await status(s, ['/full'], ...linked)).toBe(0);
    expect(await status(s, ['/none'], ...linked)).not.toBe(0);
    expect(await status(s, ['/missing'], ...linked)).not.toBe(0);
  });

  it('movedTo passes when the new target is linked and the old one is not', async () => {
    const s = await serving({
      '/old': '<a href="/old-url">x</a>',
      '/both': '<a href="/old-url">x</a><a href="/new-url">y</a>',
      '/new': '<a href="/new-url">y</a>',
      '/neither': '<a href="/else">y</a>',
    });
    const moved = [
      ANCHOR_HREFS,
      movedTo(hrefForms('https://a.test/old-url'), hrefForms('https://a.test/new-url')),
    ];
    expect(await status(s, ['/old'], ...moved)).not.toBe(0);
    expect(await status(s, ['/both'], ...moved)).not.toBe(0);
    expect(await status(s, ['/neither'], ...moved)).not.toBe(0);
    expect(await status(s, ['/missing'], ...moved)).not.toBe(0);
    expect(await status(s, ['/new'], ...moved)).toBe(0);
  });

  it('noneOf passes when the page has link text and none of it is a listed text, in any case', async () => {
    const s = await serving({
      '/generic': '<a href="/a">CLICK HERE</a><a href="/b">Ridge tent</a>',
      '/named': '<a href="/a">Ridge footprint</a><a href="/b">Ridge tent</a>',
      '/empty': '<p>no links</p>',
    });
    const none = [ANCHOR_TEXTS, noneOf([crawledWord('Click here'), crawledWord('more')])];
    expect(await status(s, ['/generic'], ...none)).not.toBe(0);
    expect(await status(s, ['/empty'], ...none)).not.toBe(0);
    expect(await status(s, ['/missing'], ...none)).not.toBe(0);
    expect(await status(s, ['/named'], ...none)).toBe(0);
  });

  it('hreflangHolds passes on a self-reference, an x-default, each return, and nothing gone', async () => {
    const head = (links: [string, string][]) =>
      `<head>${links.map(([l, h]) => `<link rel="alternate" hreflang="${l}" href="${h}">`).join('')}</head>`;
    const s = await serving({
      '/ok': head([
        ['en', 'https://a.test/ok'],
        ['de', 'https://a.test/de'],
        ['x-default', 'https://a.test/ok'],
      ]),
      '/no-self': head([
        ['de', 'https://a.test/de'],
        ['x-default', 'https://a.test/no-self'],
      ]),
      '/no-default': head([
        ['en', 'https://a.test/no-default'],
        ['de', 'https://a.test/de'],
      ]),
      '/bad-code': head([
        ['en-UK', 'https://a.test/bad-code'],
        ['de', 'https://a.test/de'],
        ['x-default', 'https://a.test/'],
      ]),
    });
    const holds = (path: string, must: string[], gone: string[]) => [
      HREFLANG_PAIRS,
      hreflangHolds(
        hrefForms(`https://a.test${path}`)[0]!,
        must.map((m) => crawledWord(m)),
        gone.map((g) => crawledWord(g)),
      ),
    ];
    expect(await status(s, ['/ok'], ...holds('/ok', ['https://a.test/de'], ['en-UK']))).toBe(0);
    expect(await status(s, ['/ok'], ...holds('/ok', ['https://a.test/fr'], []))).not.toBe(0);
    expect(await status(s, ['/ok'], ...holds('/ok', [], ['https://a.test/de']))).not.toBe(0);
    expect(await status(s, ['/no-self'], ...holds('/no-self', [], []))).not.toBe(0);
    expect(await status(s, ['/no-default'], ...holds('/no-default', [], []))).not.toBe(0);
    expect(await status(s, ['/bad-code'], ...holds('/bad-code', [], ['en-UK']))).not.toBe(0);
    expect(await status(s, ['/missing'], ...holds('/missing', [], []))).not.toBe(0);
  });

  it('linksBeyondFirst passes when the later page links somewhere new that is not the list itself', async () => {
    const nav = '<a href="/list">1</a><a href="/list?page=2">2</a><a href="/list?page=3">3</a>';
    const s = await serving({
      '/list': `${nav}<a href="/item/1">one</a>`,
      '/list?page=2': `${nav}<a href="/item/1">one</a>`,
      '/list?page=3': `${nav}<a href="/item/2">two</a>`,
    });
    const beyond = [
      ANCHOR_HREFS,
      linksBeyondFirst(crawledWord('page='), hrefForms('https://a.test/list')),
    ];
    expect(await status(s, ['/list', '/list?page=2'], ...beyond)).not.toBe(0);
    expect(await status(s, ['/list', '/list?page=3'], ...beyond)).toBe(0);
    expect(await status(s, ['/list', '/missing'], ...beyond)).not.toBe(0);
  });

  it('both passes when each command passes', async () => {
    const s = await serving({ '/p': '<a href="/t">x</a>' });
    const one = (target: string) =>
      command(
        fetchOf(NO_CRAWLER, [`${s.base}/p`]).fragment,
        ANCHOR_HREFS,
        anyOf(hrefForms(target)),
      );
    const fragmentOf = (c: ReturnType<typeof command>): Fragment => ({
      parts: [commandOf(c)],
      values: [],
    });
    const run = async (a: string, b: string) =>
      (await runCommand(commandOf(command(both(fragmentOf(one(a)), fragmentOf(one(b))))))).status;
    expect(await run('https://a.test/t', 'https://a.test/t')).toBe(0);
    expect(await run('https://a.test/t', 'https://a.test/u')).not.toBe(0);
    expect(await run('https://a.test/u', 'https://a.test/t')).not.toBe(0);
  });
});

describe('a command over hostile values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'packets-html-checks-'));
  const marker = join(dir, 'ran');
  afterEach(() => rmSync(marker, { force: true }));

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
        const built = commandOf(
          command(
            part`printf '<a href="/x">y</a>'`,
            ANCHOR_HREFS,
            movedTo(hrefForms(target), [crawledWord(text)]),
            part` ; printf '<a href="/x">y</a>'`,
            ANCHOR_TEXTS,
            noneOf([crawledWord(text), crawledWord(path)]),
            HREFLANG_PAIRS,
            hreflangHolds(crawledWord(path), [crawledWord(text)], [crawledWord(path)]),
            linksBeyondFirst(crawledWord(text), [crawledWord(path)]),
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
