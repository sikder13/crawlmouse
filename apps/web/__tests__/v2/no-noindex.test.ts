import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { WEB_ROOT } from './_lib/tokens-css';

/**
 * No v2 component decides whether a page is indexed. That is the route's call, made in its own
 * metadata, and today only the preview group's layout makes it (noindex, because the previews are
 * development pages). A component that carried a robots directive would de-index every live page
 * it lands on at cutover (docs/OPERATING-RULES.md §13).
 *
 * What this reads: the source text of every file under components/v2 and styles/v2. What it
 * cannot see: a directive assembled at run time from pieces (`'no' + 'index'`) — no scan of text
 * can, and the matcher cases below show which spellings it does catch.
 */

/** Each way a robots directive is spelled in this stack, and the rule that catches it. */
const DIRECTIVES: [string, RegExp][] = [
  ['noindex', /\bno[\s_-]*index\b/i],
  ['index: false', /\bindex["'`]?\s*[:=]\s*\{?\s*false\b/i],
  ['a robots meta', /\bname["'`]?\s*[:=]\s*\{?\s*["'`](?:robots|[\w-]*bot)["'`]/i],
  ['X-Robots-Tag', /\bx[\s_-]*robots[\s_-]*tag\b/i],
  ['robots metadata', /\brobots["'`]?\s*:\s*[{"'`]/i],
];

const directivesIn = (src: string) => DIRECTIVES.filter(([, re]) => re.test(src)).map(([n]) => n);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const V2_DIRS = [join(WEB_ROOT, 'components', 'v2'), join(WEB_ROOT, 'styles', 'v2')];
const PREVIEW_LAYOUT = join(WEB_ROOT, 'app', '(v2-preview)', 'layout.tsx');

describe('no v2 component sets a robots directive', () => {
  const files = V2_DIRS.flatMap(walk);

  it('reads the whole v2 component and style tree', () => {
    expect(files.some((f) => f.endsWith('PageShell.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('SiteFooter.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('tokens.css'))).toBe(true);
    expect(files.some((f) => f.includes(`${join('screens', 'home')}`))).toBe(true);
  });

  it('finds none under components/v2 or styles/v2', () => {
    const offenders = files
      .map((f) => [relative(WEB_ROOT, f), directivesIn(readFileSync(f, 'utf8'))] as const)
      .filter(([, found]) => found.length);
    expect(offenders).toEqual([]);
  });

  it('finds the one the preview group sets, so the scan can see a real directive', () => {
    expect(directivesIn(readFileSync(PREVIEW_LAYOUT, 'utf8'))).toEqual(
      expect.arrayContaining(['index: false', 'robots metadata']),
    );
  });
});

describe('the directive matcher', () => {
  // Varied on what each rule keys on: case, separator, quoting, JSX and object forms, and the meta
  // name, since a meta named for one crawler de-indexes as surely as one named robots.
  it.each([
    ['<meta name="robots" content="noindex" />', 'noindex'],
    ['<meta name="robots" content="index" />', 'a robots meta'],
    ["<meta name='ROBOTS' content='none'/>", 'a robots meta'],
    ['<meta name="googlebot" content="index, follow" />', 'a robots meta'],
    ['<meta name="GPTBot" content="noai" />', 'a robots meta'],
    ["createElement('meta', { name: 'robots', content: 'all' })", 'a robots meta'],
    ['<meta name={"robots"} content={x} />', 'a robots meta'],
    ['export const metadata = { robots: { index: false } };', 'index: false'],
    ['export const metadata = { robots: { index: false } };', 'robots metadata'],
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

  // What a v2 component legitimately says about robots: the robots.txt verdicts and copy.
  it.each([
    'blocked by robots.txt',
    "| 'disallowed_by_robots'",
    'robots.txt says what you intend.',
    'indexable: false',
    'reindex the site',
    'a piano index',
    "name: 'Crawlmouse'",
    'aria-label="Footer"',
  ])('passes %s', (src) => {
    expect(directivesIn(src)).toEqual([]);
  });
});
