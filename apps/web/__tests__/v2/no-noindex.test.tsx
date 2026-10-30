import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageShell } from '../../components/v2/PageShell';
import { SiteFooter } from '../../components/v2/SiteFooter';
import { MARKETING_NAV } from '../../components/v2/footer-links';
import { RESULT_NAMES, crawlElement, homeElement, resultElement } from './_lib/screens';
import { WEB_ROOT } from './_lib/tokens-css';

/**
 * No v2 component decides whether a page is indexed, or what it is called or canonical to. Those
 * are the route's calls, made in its own metadata. In the v2 code (the two folders below and the
 * preview group) the one file that makes such a call is the preview group's layout (noindex,
 * because the previews are development pages); the third test checks that. A component that rendered a
 * robots meta, a title or a canonical link would apply it to each live page it lands on at
 * cutover (docs/OPERATING-RULES.md §13).
 *
 * Two checks, because neither covers the other:
 * - The source of each file under components/v2 and styles/v2 is scanned for any head element
 *   (meta, title, link, base) written as JSX or through createElement, for a route metadata
 *   export or next/head, and for the spellings of a robots directive below. The head-element rule
 *   is what catches a directive whose name or content is a variable or an entity.
 * - The screens (each Result state, the Crawl screen at its start and end) and the shell are
 *   rendered as their previews render them, and the markup must hold no head element.
 * What neither can see: an element whose tag name is held in a variable (`<Tag>`, `h(T)`) and
 *   that renders only under props the fixtures do not use, or a directive reached through an
 *   import from outside these two folders.
 * Known false positives: the noindex rule has no word boundaries, so ordinary prose such as
 *   "no index" trips it too. The head-element rules also match an SVG's <title>, and any call
 *   whose first argument is a head tag's name (getAttribute('title'), t('link'), useState('base')).
 *   Reword the code, or give the SVG an aria-label, rather than loosen a rule.
 */

/** Each way a robots or head directive is spelled in this stack, and the rule that catches it. */
const DIRECTIVES: [string, RegExp][] = [
  // No word boundary either side, so it is found inside an identifier too (noindexRobots).
  ['noindex', /no[\s_-]*index/i],
  ['index: false', /\bindex["'`]?\s*[:=]\s*\{?\s*false\b/i],
  ['a robots meta', /\bname["'`]?\s*[:=]\s*\{?\s*["'`](?:robots|[\w-]*bot[\w-]*)["'`]/i],
  ['X-Robots-Tag', /\bx[\s_-]*robots[\s_-]*tag\b/i],
  // Any value: an object, a string, or a name (robots: NOINDEX, metadata.robots = r).
  ['robots metadata', /\brobots["'`]?\s*[:=]\s*[{"'`\w]/i],
  // Lower case only: JSX reserves lower-case tags for HTML elements, so <Link> (next/link) passes.
  ['a head element', /<\s*(?:meta|title|link|base)\b/],
  // A head tag as the first argument of any call: createElement, a renamed factory (h, jsx), or
  // document.createElement in an effect, which no render here would run.
  ['a head element', /\(\s*["'`](?:meta|title|link|base)["'`]/i],
  ['next/head', /\bnext\/head\b/],
  [
    'route metadata',
    /export\s+(?:const|let|var|(?:async\s+)?function)\s+(?:metadata|generateMetadata)\b/,
  ],
];

const directivesIn = (src: string) => [
  ...new Set(DIRECTIVES.filter(([, re]) => re.test(src)).map(([n]) => n)),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const V2_DIRS = [join(WEB_ROOT, 'components', 'v2'), join(WEB_ROOT, 'styles', 'v2')];
const PREVIEW_GROUP = join(WEB_ROOT, 'app', '(v2-preview)');
const PREVIEW_LAYOUT = join(PREVIEW_GROUP, 'layout.tsx');

describe('no v2 component sets a robots directive or a head element', () => {
  const files = V2_DIRS.flatMap(walk);

  it('reads every file git tracks under the two folders', () => {
    const walked = new Set(files.map((f) => relative(WEB_ROOT, f)));
    const tracked = execFileSync('git', ['ls-files', 'components/v2', 'styles/v2'], {
      cwd: WEB_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(40);
    expect(tracked.filter((f) => !walked.has(f))).toEqual([]);
  });

  it('finds none in the source under components/v2 or styles/v2', () => {
    const offenders = files
      .map((f) => [relative(WEB_ROOT, f), directivesIn(readFileSync(f, 'utf8'))] as const)
      .filter(([, found]) => found.length);
    expect(offenders).toEqual([]);
  });

  it('finds the one the preview group sets, in its layout and in no other file of the group', () => {
    expect(directivesIn(readFileSync(PREVIEW_LAYOUT, 'utf8'))).toEqual(
      expect.arrayContaining(['index: false', 'robots metadata', 'route metadata']),
    );
    const setters = walk(PREVIEW_GROUP)
      .filter((f) => directivesIn(readFileSync(f, 'utf8')).length)
      .map((f) => relative(PREVIEW_GROUP, f));
    expect(setters).toEqual(['layout.tsx']);
  });

  const HEAD = /<(?:meta|title|link|base)\b/;
  const RENDERED: [string, () => React.ReactElement][] = [
    ['Home', homeElement],
    ['Crawl, at its start', () => crawlElement('bad-site', '0')],
    ['Crawl, at its end', () => crawlElement('challenged-site', 'end')],
    ...RESULT_NAMES.map((n): [string, () => React.ReactElement] => [
      `Result: ${n}`,
      () => resultElement(n),
    ]),
    [
      'the marketing shell',
      () => (
        <PageShell nav={MARKETING_NAV} status="down">
          <main>x</main>
        </PageShell>
      ),
    ],
    [
      'the app shell',
      () => (
        <PageShell header="app" footer={false}>
          <main>x</main>
        </PageShell>
      ),
    ],
    ['the footer alone', () => <SiteFooter status="ok" />],
  ];
  it.each(RENDERED)('renders no head element in %s', (_, el) => {
    const markup = renderToStaticMarkup(el());
    expect(markup.length).toBeGreaterThan(100);
    expect(markup.match(HEAD)).toBeNull();
  });
});

describe('the directive matcher', () => {
  // Varied on what each rule keys on: case, separator, what stands either side of the word,
  // quoting, JSX and object forms, the value's form (object, string, name), entities and variables,
  // and the meta name, since a meta named for one crawler de-indexes as surely as one named robots.
  it.each([
    ['<meta name="robots" content="noindex" />', 'noindex'],
    ['const noindexRobots = true;', 'noindex'],
    ['const ROBOTS_NOINDEX = 1;', 'noindex'],
    ['isNoIndex(page)', 'noindex'],
    ['export const V2_METADATA = { robots: NOINDEX_ROBOTS };', 'robots metadata'],
    ["metadata.robots = 'none';", 'robots metadata'],
    ['metadata.robots=r', 'robots metadata'],
    ['<meta name="robots" content="index" />', 'a robots meta'],
    ["<meta name='ROBOTS' content='none'/>", 'a robots meta'],
    ['<meta name="googlebot" content="index, follow" />', 'a robots meta'],
    ['<meta name="googlebot-news" content="none" />', 'a robots meta'],
    ['<meta name="GPTBot" content="noai" />', 'a robots meta'],
    ["createElement('meta', { name: 'robots', content: 'all' })", 'a robots meta'],
    ['<meta name={"robots"} content={x} />', 'a robots meta'],
    ['<meta name={META_NAME} content="none" />', 'a head element'],
    ['<meta name="&#114;obots" content="none" />', 'a head element'],
    ['<meta name="\\u0072obots" content="none" />', 'a head element'],
    ['< meta name={n} />', 'a head element'],
    ['<link rel="canonical" href="/" />', 'a head element'],
    ['<title>Crawlmouse</title>', 'a head element'],
    ['<base href="/" />', 'a head element'],
    ["React.createElement('link', { rel: 'canonical', href: '/' })", 'a head element'],
    ["h('meta', { name: N, content: 'none' })", 'a head element'],
    ["jsx('meta', { name: 'robots' })", 'a head element'],
    ["document.createElement('meta')", 'a head element'],
    ["import Head from 'next/head';", 'next/head'],
    ['export const metadata = { robots: { index: false } };', 'index: false'],
    ['export const metadata = { robots: { index: false } };', 'robots metadata'],
    ['export const metadata = { robots: { index: false } };', 'route metadata'],
    ['export async function generateMetadata() {', 'route metadata'],
    ['export function generateMetadata() {', 'route metadata'],
    ['const meta = { robots: r };', 'robots metadata'],
    ["robots: 'noindex, nofollow'", 'robots metadata'],
    ['{ "robots": "none" }', 'robots metadata'],
    ['{ "index": false }', 'index: false'],
    ['index:false', 'index: false'],
    ['NoIndex', 'noindex'],
    ['no-index', 'noindex'],
    ['NO_INDEX', 'noindex'],
    ["headers.set('X-Robots-Tag', 'none')", 'X-Robots-Tag'],
    ['x-robots-tag: noindex', 'X-Robots-Tag'],
  ])('catches %s (%s)', (src, rule) => {
    expect(directivesIn(src)).toContain(rule);
  });

  // What a v2 component legitimately says or renders: the robots.txt verdicts and copy, links,
  // and components whose names start like a head element.
  it.each([
    'blocked by robots.txt',
    "| 'disallowed_by_robots'",
    'robots.txt says what you intend.',
    'indexable: false',
    'reindex the site',
    'the known index of pages',
    "name: 'Crawlmouse'",
    'aria-label="Footer"',
    '<Link href="/blog">Blog</Link>',
    '<LinkMap variant="thumb" />',
    '<a href="/status">Status</a>',
    '<linkMap />',
  ])('passes %s', (src) => {
    expect(directivesIn(src)).toEqual([]);
  });
});
