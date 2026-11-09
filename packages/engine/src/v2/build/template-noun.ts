/**
 * A reader's name for a template known only by its key (`templateKeyFor`, analysis/template-key.ts):
 * "product pages" for `/products/{slug}`, "the homepage" for `/`. The titles of the fixes that name a
 * template (grade/outcomes.ts) and the `where` of the change rows those fixes write (diff/changes.ts)
 * use it; the fix keeps its `template_key`.
 *
 * - `/` is the homepage.
 * - A key with no placeholder names one path: templateKeyFor keeps a top-level segment, and a short
 *   hyphen-free last segment, as written (lower-cased, its query left out). "the /about page".
 * - A key under a first segment SECTIONS names takes that noun, at any depth under it.
 * - A key under another first segment written out: "pages under /shop/".
 * - A key whose first segment is a placeholder names no section: "pages like /{n}/{slug}".
 */

/**
 * The sections a reader knows by name, each as the web's TEMPLATE_NOUNS calls its pages
 * (apps/web/lib/v2/format.ts; template-noun.test.ts holds the two to each other).
 */
export const SECTIONS: Readonly<Record<string, string>> = {
  aircraft: 'aircraft pages',
  blog: 'blog posts',
  collections: 'collection pages',
  guides: 'guides',
  journal: 'journal posts',
  news: 'news posts',
  products: 'product pages',
  services: 'service pages',
  vehicles: 'vehicle pages',
  work: 'work pages',
};

const PLACEHOLDER = /^\{[a-z]+\}$/;

function segmentsOf(key: string): string[] {
  if (!key.startsWith('/'))
    throw new Error(`templateNoun: ${JSON.stringify(key)} is not a template key`);
  return key.split('/').filter(Boolean);
}

/** The key names one path: the homepage, or a key with no placeholder in it. */
export function namesOnePage(key: string): boolean {
  return !segmentsOf(key).some((s) => PLACEHOLDER.test(s));
}

export function templateNoun(key: string): string {
  const [first] = segmentsOf(key);
  if (first === undefined) return 'the homepage';
  if (namesOnePage(key)) return `the ${key} page`;
  if (PLACEHOLDER.test(first)) return `pages like ${key}`;
  return Object.hasOwn(SECTIONS, first) ? SECTIONS[first]! : `pages under /${first}/`;
}
