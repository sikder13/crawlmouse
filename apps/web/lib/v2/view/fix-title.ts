import type { Fix } from '@crawlmouse/types/v2';

type Titled = Pick<Fix, 'id' | 'title' | 'template_key'>;

/**
 * A fix's title as a list shows it beside the site's other fixes (D-12). Fixes made from different
 * templates of one section can share a title word for word ("Describe pages under /fruit-and-veg/ in
 * their schema.org markup", three times on one production site), and the reader cannot tell them
 * apart. Where another of `siblings` has the same title and a different template, the title names its
 * own template; any other title is returned as stored.
 */
export function titleAmong(f: Titled, siblings: readonly Titled[]): string {
  if (f.template_key === null) return f.title;
  const twin = siblings.some(
    (s) => s.id !== f.id && s.title === f.title && s.template_key !== f.template_key,
  );
  return twin ? `${f.title} · template ${f.template_key}` : f.title;
}
