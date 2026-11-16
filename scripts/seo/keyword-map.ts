/**
 * docs/seo/keyword-map.md (CC-40 D6), rendered by apps/web/lib/seo/keyword-map.ts from the Search
 * Console export (apps/web/lib/seo/search-console.ts), the posts' metadata, and the indexable pages
 * of the page audit's saved runs: every URL either build's sitemap lists, with the title it served.
 *
 *   pnpm seo:keywords -- --off=docs/seo/audit-data/before-off.json --on=docs/seo/audit-data/before-on.json
 */
import { readFileSync } from 'node:fs';
import { writeFormatted } from './write-formatted';
import type { AuditRun } from '../../apps/web/lib/seo/audit-run';
import { renderKeywordMap } from '../../apps/web/lib/seo/keyword-map';
import { EXPORTED_AT, PAGES, QUERIES } from '../../apps/web/lib/seo/search-console';
import { POSTS } from '../../apps/web/lib/blog/posts';

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as AuditRun;

const runs = [arg('off'), arg('on')].map((p) => {
  if (!p) throw new Error('--off=<audit run> and --on=<audit run> are required');
  return read(p);
});
const pages = new Map<string, string | null>();
for (const run of runs)
  for (const path of run.sitemap)
    if (!pages.has(path)) pages.set(path, run.pages.find((p) => p.path === path)?.title ?? null);

const md = renderKeywordMap({
  exportedAt: EXPORTED_AT,
  pages: [...pages].map(([path, title]) => ({ path, title })),
  posts: POSTS,
  queries: QUERIES,
  pageRows: PAGES,
  pairs: [['/blog/screaming-frog-alternative', '/blog/sitebulb-vs-screaming-frog']],
});
const out = arg('md') ?? 'docs/seo/keyword-map.md';
await writeFormatted(out, md);
console.log(`${pages.size} pages → ${out}`);
