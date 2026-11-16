/**
 * docs/seo/keyword-map.md, rendered from data (OPERATING-RULES §10; CC-40 D6): for each indexable
 * page one primary query and its secondaries, the queries two pages share (possible cannibal pairs),
 * and the pairs the owner asked to be checked. Queries come from the Search Console export and are
 * ATTRIBUTED to pages by word match (`./attribution`), because the export has no page × query table;
 * a post with no attributed query takes its own keywords instead, and says so.
 */
import { attributeQueries, pageTerms, type AttributablePage } from './attribution';
import type { PageRow, QueryRow } from './search-console';
import { markdownCell } from './markdown-cell';

export interface KeywordMapInput {
  exportedAt: string;
  /** The indexable pages: every sitemap URL, with the title it served. */
  pages: readonly { path: string; title: string | null }[];
  posts: readonly { slug: string; title: string; keywords: readonly string[] }[];
  queries: readonly QueryRow[];
  pageRows: readonly PageRow[];
  /** Page pairs to report on whether or not the data ties them. */
  pairs: readonly (readonly [string, string])[];
}

export interface KeywordRow {
  path: string;
  impressions: number;
  position: number | null;
  primary: {
    query: string;
    impressions: number | null;
    source: 'attributed' | 'post keyword';
  } | null;
  secondary: string[];
}

/** Secondary queries shown per page. */
export const SECONDARIES = 4;

function attributed(input: KeywordMapInput): Map<string, QueryRow[]> {
  const bySlug = new Map(input.posts.map((p) => [`/blog/${p.slug}`, p]));
  const pages: AttributablePage[] = input.pages.map((p) =>
    pageTerms(p.path, p.title, bySlug.get(p.path)),
  );
  return attributeQueries(input.queries, pages);
}

/** How many pages each query is attributed to. */
function holders(byPath: Map<string, QueryRow[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const rows of byPath.values()) for (const r of rows) out.set(r[0], (out.get(r[0]) ?? 0) + 1);
  return out;
}

/**
 * Each page's row. Its attributed queries are ordered with those it holds alone first, then those it
 * shares with another page, each by impressions, so a page's primary query is one no other page is
 * attributed when it has one.
 */
export function keywordRows(input: KeywordMapInput): KeywordRow[] {
  const byPath = attributed(input);
  const held = holders(byPath);
  const bySlug = new Map(input.posts.map((p) => [`/blog/${p.slug}`, p]));
  return input.pages.map(({ path }) => {
    const own = input.pageRows.find((r) => r[0] === path);
    const base = { path, impressions: own?.[2] ?? 0, position: own?.[3] ?? null };
    const all = byPath.get(path) ?? [];
    const alone = (r: QueryRow) => held.get(r[0]) === 1;
    const rows = [...all.filter(alone), ...all.filter((r) => !alone(r))];
    if (rows.length > 0)
      return {
        ...base,
        primary: { query: rows[0]![0], impressions: rows[0]![2], source: 'attributed' as const },
        secondary: rows.slice(1, 1 + SECONDARIES).map((r) => `${r[0]} (${r[2]})`),
      };
    const post = bySlug.get(path);
    if (post && post.keywords.length > 0)
      return {
        ...base,
        primary: { query: post.keywords[0]!, impressions: null, source: 'post keyword' as const },
        secondary: post.keywords.slice(1, 1 + SECONDARIES),
      };
    return { ...base, primary: null, secondary: [] };
  });
}

export interface CannibalPair {
  query: string;
  impressions: number;
  position: number;
  pages: string[];
}

/** Each query attributed to more than one page, by impressions, most first. */
export function cannibalPairs(input: KeywordMapInput): CannibalPair[] {
  const pagesOf = new Map<string, string[]>();
  for (const [path, rows] of attributed(input))
    for (const r of rows) pagesOf.set(r[0], [...(pagesOf.get(r[0]) ?? []), path]);
  return input.queries
    .filter((q) => (pagesOf.get(q[0]) ?? []).length > 1)
    .map((q) => ({ query: q[0], impressions: q[2], position: q[3], pages: pagesOf.get(q[0])! }))
    .sort((a, b) => b.impressions - a.impressions);
}

/** Shared impressions at or above which a page pair is listed for the owner. */
export const OWNER_THRESHOLD = 100;

/** Each pair of pages that shares attributed queries: the impressions and queries they share. */
export function sharedImpressions(pairs: readonly CannibalPair[]) {
  const by = new Map<string, { pages: [string, string]; impressions: number; queries: number }>();
  for (const p of pairs)
    for (let i = 0; i < p.pages.length; i += 1)
      for (let j = i + 1; j < p.pages.length; j += 1) {
        const pages = [p.pages[i]!, p.pages[j]!].sort() as [string, string];
        const key = pages.join(' ');
        const x = by.get(key) ?? { pages, impressions: 0, queries: 0 };
        x.impressions += p.impressions;
        x.queries += 1;
        by.set(key, x);
      }
  return [...by.values()].sort((a, b) => b.impressions - a.impressions);
}

const code = (p: string) => `\`${p}\``;

export function renderKeywordMap(input: KeywordMapInput): string {
  const rows = keywordRows(input);
  const pairs = cannibalPairs(input);
  const byPath = attributed(input);
  const attributedQueries = new Set([...byPath.values()].flat().map((r) => r[0]));
  const unattributed = input.queries.filter((q) => !attributedQueries.has(q[0])).length;
  const primary = (r: KeywordRow) =>
    r.primary === null
      ? '—'
      : r.primary.source === 'attributed'
        ? `${r.primary.query} (${r.primary.impressions}, attributed)`
        : `${r.primary.query} (post keyword)`;

  const out = [
    '# Keyword map',
    '',
    `Rendered by \`pnpm seo:keywords\` (\`scripts/seo/keyword-map.ts\`, \`apps/web/lib/seo/keyword-map.ts\`) from the Search Console export of ${input.exportedAt} and the page audit's runs. Do not edit by hand.`,
    '',
    'The export has no page × query table, so a query is attributed to the page whose slug, title and keywords cover most of its words (`apps/web/lib/seo/attribution.ts`). A page with no attributed query takes its first keyword from `lib/blog/posts.ts` when it is a post. Impressions and position are the page’s own, from the export’s Pages table.',
    '',
    `${unattributed} of ${input.queries.length} queries in the export are attributed to no page.`,
    '',
    '## Primary and secondary queries',
    '',
    '| Page | Impr. | Pos. | Primary query | Secondary queries |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${code(r.path)} | ${r.impressions} | ${r.position ?? '—'} | ${markdownCell(primary(r))} | ${markdownCell(r.secondary.join('; ') || '—')} |`,
    ),
    '',
    '## Queries attributed to more than one page',
    '',
    'Possible cannibal pairs. Merging, moving or retitling either page is the owner’s call and is not done in CC-40.',
    '',
  ];
  if (pairs.length === 0) out.push('None.');
  else
    out.push(
      '| Query | Impr. | Pos. | Pages |',
      '| --- | --- | --- | --- |',
      ...pairs.map(
        (p) =>
          `| ${markdownCell(p.query)} | ${p.impressions} | ${p.position} | ${p.pages.map(code).join(', ')} |`,
      ),
    );
  out.push('', '## For the owner', '');
  const shared = sharedImpressions(pairs).filter((x) => x.impressions >= OWNER_THRESHOLD);
  if (shared.length === 0)
    out.push(`No two pages share ${OWNER_THRESHOLD} or more impressions of attributed queries.`);
  else {
    out.push(
      `Pages that share ${OWNER_THRESHOLD} or more impressions of attributed queries. Whether to merge, retitle or re-aim either page of a pair is the owner’s decision and is not done in CC-40.`,
      '',
      ...shared.map(
        (x) =>
          `- ${code(x.pages[0])} and ${code(x.pages[1])} share ${x.impressions} impressions over ${x.queries} ${x.queries === 1 ? 'query' : 'queries'}.`,
      ),
    );
  }
  out.push('', '## Pairs checked by name', '');
  for (const [a, b] of input.pairs) {
    const both = pairs.filter((p) => p.pages.includes(a) && p.pages.includes(b));
    out.push(`### ${code(a)} and ${code(b)}`, '');
    out.push(
      both.length === 0
        ? 'Queries attributed to both: none.'
        : `Queries attributed to both: ${both.map((p) => `${p.query} (${p.impressions})`).join('; ')}.`,
    );
    for (const path of [a, b]) {
      const r = rows.find((x) => x.path === path);
      const top = (byPath.get(path) ?? [])
        .slice(0, 3)
        .map((q) => `${q[0]} (${q[2]}, pos. ${q[3]})`);
      out.push(
        `- ${code(path)}: ${r?.impressions ?? 0} impressions at ${r?.position ?? '—'}; top attributed queries: ${top.join('; ') || 'none'}.`,
      );
    }
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
