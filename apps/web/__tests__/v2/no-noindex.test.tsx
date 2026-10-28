import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeScreen } from '../../components/v2/screens/home/HomeScreen';
import { ResultScreen } from '../../components/v2/screens/result/ResultScreen';
import { PageShell } from '../../components/v2/PageShell';
import { SiteFooter } from '../../components/v2/SiteFooter';
import { MARKETING_NAV } from '../../components/v2/footer-links';
import { HOME_FIXTURE } from '../../app/(v2-preview)/v2-preview/_fixtures/home';
import { RESULT_FIXTURE } from '../../app/(v2-preview)/v2-preview/_fixtures/result';
import { WEB_ROOT } from './_lib/tokens-css';

/**
 * No v2 component decides whether a page is indexed, or what it is called or canonical to. Those
 * are the route's calls, made in its own metadata; in the v2 tree only the preview group's layout
 * makes one (noindex, because the previews are development pages). A component that rendered a
 * robots meta, a title or a canonical link would apply it to each live page it lands on at
 * cutover (docs/OPERATING-RULES.md §13).
 *
 * Two checks, because neither covers the other:
 * - The source of each file under components/v2 and styles/v2 is scanned for any head element
 *   (meta, title, link, base) written as JSX or through createElement, for a route metadata
 *   export or next/head, and for the spellings of a robots directive below. The head-element rule
 *   is what catches a directive whose name or content is a variable or an entity.
 * - The two screens and the shell are rendered with the preview fixtures, and the markup must hold
 *   no head element.
 * What neither can see: an element whose tag name is itself computed at run time and that renders
 *   only under props the fixtures do not use, or a directive reached through an import from
 *   outside these two folders.
 */

/** Each way a robots or head directive is spelled in this stack, and the rule that catches it. */
const DIRECTIVES: [string, RegExp][] = [
  ['noindex', /\bno[\s_-]*index\b/i],
  ['index: false', /\bindex["'`]?\s*[:=]\s*\{?\s*false\b/i],
  ['a robots meta', /\bname["'`]?\s*[:=]\s*\{?\s*["'`](?:robots|[\w-]*bot[\w-]*)["'`]/i],
  ['X-Robots-Tag', /\bx[\s_-]*robots[\s_-]*tag\b/i],
  ['robots metadata', /\brobots["'`]?\s*:\s*[{"'`\w]/i],
  // Lower case only: JSX reserves lower-case tags for HTML elements, so <Link> (next/link) passes.
  ['a head element', /<\s*(?:meta|title|link|base)\b/],
  ['a head element', /createElement\(\s*["'`](?:meta|title|link|base)["'`]/i],
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
const PREVIEW_LAYOUT = join(WEB_ROOT, 'app', '(v2-preview)', 'layout.tsx');

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

  it('finds the one the preview group sets, so the scan can see a real directive', () => {
    expect(directivesIn(readFileSync(PREVIEW_LAYOUT, 'utf8'))).toEqual(
      expect.arrayContaining(['index: false', 'robots metadata', 'route metadata']),
    );
  });

  const HEAD = /<(?:meta|title|link|base)\b/;
  it.each([
    ['Home', () => <HomeScreen data={HOME_FIXTURE} />],
    ['Result', () => <ResultScreen data={RESULT_FIXTURE} />],
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
  ])('renders no head element in %s', (_, el) => {
    const markup = renderToStaticMarkup(el());
    expect(markup.length).toBeGreaterThan(100);
    expect(markup.match(HEAD)).toBeNull();
  });
});

describe('the directive matcher', () => {
  // Varied on what each rule keys on: case, separator, quoting, JSX and object forms, entities and
  // variables, and the meta name, since a meta named for one crawler de-indexes as surely as one
  // named robots.
  it.each([
    ['<meta name="robots" content="noindex" />', 'noindex'],
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
    'a piano index',
    "name: 'Crawlmouse'",
    'aria-label="Footer"',
    '<Link href="/blog">Blog</Link>',
    '<LinkMapGraph variant="thumb" />',
    '<a href="/status">Status</a>',
    '<linkMap />',
  ])('passes %s', (src) => {
    expect(directivesIn(src)).toEqual([]);
  });
});
