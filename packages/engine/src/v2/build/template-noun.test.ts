/**
 * The reader's noun for a template (CC-20b D11), over every template key the fixtures hold, and the
 * fix titles and change rows that name a template with it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';
import { templateKeyFor } from '../../analysis/template-key.js';
import { TITLES } from '../grade/outcomes.js';
import { buildCheck } from './build.js';
import { namesOnePage, SECTIONS, templateNoun } from './template-noun.js';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const KEY = /["']?template_key["']?\s*:\s*["']([^"']+)["']/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Every template key written in the engine's fixtures and the web's fixture datasets. */
function fixtureKeys(): string[] {
  const web = join(REPO, 'apps/web/lib/fixtures/v2');
  const sources = [
    ...files(join(REPO, 'packages/engine/fixtures')),
    ...readdirSync(web)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(web, f)),
  ];
  const keys = sources.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(KEY)].map((m) => m[1]!));
  return [...new Set(keys)].sort();
}

/** Every key the fixtures hold, with the noun a reader is given; written by hand. */
const NOUNS: Record<string, string> = {
  '/': 'the homepage',
  '/aircraft/{slug}': 'aircraft pages',
  '/blog/{slug}': 'blog posts',
  '/collections/{slug}': 'collection pages',
  '/guides/{slug}': 'guides',
  '/hypertext/{slug}': 'pages under /hypertext/',
  '/journal/{slug}': 'journal posts',
  '/news/{slug}': 'news posts',
  '/p/{n}': 'pages under /p/',
  '/products/{slug}': 'product pages',
  '/robots.txt': 'the /robots.txt page',
  '/sections/{slug}': 'pages under /sections/',
  '/services/{slug}': 'service pages',
  '/vehicles/{slug}': 'vehicle pages',
  '/work/{slug}': 'work pages',
};

describe('templateNoun, over every template key in the fixtures', () => {
  const keys = fixtureKeys();

  it('the scan finds the keys, and the table holds exactly them', () => {
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toEqual(Object.keys(NOUNS).sort());
  });

  it.each(Object.entries(NOUNS))('%s is %s', (key, noun) => {
    expect(templateNoun(key)).toBe(noun);
  });
});

describe('the sections the noun table names', () => {
  it("are the web's TEMPLATE_NOUNS, each section by its list name and its pages' noun", () => {
    const source = readFileSync(join(REPO, 'apps/web/lib/v2/format.ts'), 'utf8');
    const entries = [
      ...source.matchAll(/(\w+): \{ inList: '([^']+)', adjective: '[^']*', pages: '([^']+)' \}/g),
    ];
    const web = Object.fromEntries(
      entries.filter((m) => m[1] !== 'Homepage').map((m) => [m[2]!, m[3]!]),
    );
    expect(Object.keys(web).length).toBeGreaterThan(5);
    expect(SECTIONS).toEqual(web);
    expect(entries.find((m) => m[1] === 'Homepage')?.[3]).toBe(templateNoun('/'));
  });
});

describe('templateNoun, by what the key holds', () => {
  it.each([
    // a section the table names, at any depth under it
    ['/blog/{n}/{slug}', 'blog posts'],
    ['/products/{id}', 'product pages'],
    // a key with no placeholder is one page: depth-1 segments, and a short hyphen-free last one, stay literal
    ['/blog', 'the /blog page'],
    ['/products', 'the /products page'],
    ['/shop/hats', 'the /shop/hats page'],
    // a section the table does not name
    ['/shop/{slug}', 'pages under /shop/'],
    ['/docs/api/{slug}', 'pages under /docs/'],
    // a first segment that is itself a placeholder names no section
    ['/{n}/{n}/{slug}', 'pages like /{n}/{n}/{slug}'],
    ['/{n}', 'pages like /{n}'],
  ])('%s is %s', (key, noun) => {
    expect(templateNoun(key)).toBe(noun);
  });

  it('agrees with the keys templateKeyFor makes', () => {
    expect(templateNoun(templateKeyFor('https://a.test/products/blue-tent'))).toBe('product pages');
    expect(templateNoun(templateKeyFor('https://a.test/about'))).toBe('the /about page');
    expect(templateNoun(templateKeyFor('https://a.test/2026/03/a-post'))).toBe(
      'pages like /{n}/{n}/{slug}',
    );
  });

  it('says which keys name one page', () => {
    expect(['/', '/about', '/shop/hats'].map(namesOnePage)).toEqual([true, true, true]);
    expect(['/blog/{slug}', '/{n}', '/p/{n}'].map(namesOnePage)).toEqual([false, false, false]);
  });

  it('refuses what is not a template key', () => {
    for (const bad of ['', 'blog/{slug}', 'https://a.test/x']) {
      expect(() => templateNoun(bad), bad).toThrow(/not a template key/);
    }
  });
});

describe('the titles of the fixes that name a template', () => {
  it.each([
    ['quotable_opening', 'Open blog posts with a direct answer'],
    ['missing_author_date', 'Show an author and a date on blog posts'],
    ['specs_as_images', 'Give the specifications on blog posts as text'],
    ['missing_schema_description', 'Describe blog posts in their schema.org markup'],
    ['no_question_headings', 'Phrase a section heading on blog posts as a question'],
    ['duplicate_pagination', 'Make the later pages of blog posts distinct'],
  ] as const)('%s: %s', (type, title) => {
    expect(TITLES[type]!('/blog/{slug}')).toBe(title);
  });

  it('says "its" for a template of one page', () => {
    expect(TITLES.missing_schema_description!('/')).toBe(
      'Describe the homepage in its schema.org markup',
    );
  });
});

describe('the built check names its templates by their nouns', () => {
  const built = buildCheck(recordedBuild());
  const named = built.fixes.filter((f) => f.template_key !== null);

  it('in the title of each fix that names one, keeping its template_key', () => {
    expect(named.length).toBeGreaterThan(0);
    for (const f of named) {
      expect(f.template_key, f.title).toMatch(/^\//);
      expect(f.title, f.template_key!).toContain(templateNoun(f.template_key!));
      expect(f.title).not.toContain(f.template_key!);
    }
  });

  it('in the `where` of the change each of those fixes writes', () => {
    for (const f of named) {
      const rows = built.changes.filter((c) => c.fix_id === f.id);
      expect(rows.length, f.title).toBeGreaterThan(0);
      for (const c of rows) expect(c.where).toBe(templateNoun(f.template_key!));
    }
  });
});
