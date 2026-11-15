/**
 * docs/seo/page-audit.md, rendered from the audit's saved runs (OPERATING-RULES §10: prose that names
 * measured data is built from the data). Every count, list and cause below is computed here from the
 * runs and the Search Console export; nothing in the output is written by hand.
 */
import type { AuditRun, SavedPage } from './audit-run';
import { isNoindex } from './audit-run';
import { attributeQueries, type AttributablePage } from './attribution';
import { skippedHeadings } from './page-facts';
import { schemaProblems } from './schema-required';
import { EXPORTED_AT, INDEXED, INDEXED_AS_OF, PAGES, QUERIES } from './search-console';

export interface PostTerms {
  slug: string;
  title: string;
  keywords: readonly string[];
  publishedAt: string;
}

export interface ReportInput {
  origin: string;
  off: AuditRun;
  on: AuditRun;
  /** The runs on the tree before CC-40 changed a page, when this report is the final one. */
  before?: { off: AuditRun; on: AuditRun };
  posts: readonly PostTerms[];
  /** What `https://www.<host>/` answered, read from production. */
  www: { status: number; location: string | null; checkedAt: string } | null;
  /** The commands that produced the runs, shown so a reader can re-run them. */
  commands: readonly string[];
}

const TITLE_SUFFIX = ' · Crawlmouse';
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const isPost = (path: string) => /^\/blog\/[^/]+$/.test(path) && path !== '/blog/research';

export function canonicalIsSelf(page: SavedPage, origin: string): boolean {
  return (
    page.canonicals.length === 1 &&
    page.canonicals[0] === (page.path === '/' ? origin : `${origin}${page.path}`)
  );
}

/** Pages in `run` that link to `path`, not counting `path` itself. */
export function inLinks(run: AuditRun, path: string): string[] {
  return run.pages.filter((p) => p.path !== path && p.links.includes(path)).map((p) => p.path);
}

const jsonLdTypes = (p: SavedPage) =>
  p.jsonLd.flatMap((b) => {
    const top = Array.isArray(b.data) ? b.data : [b.data];
    return top.map((n) =>
      n && typeof n === 'object' ? String((n as Record<string, unknown>)['@type']) : 'unparsed',
    );
  });

export const jsonLdProblems = (p: SavedPage) => [
  ...p.jsonLd.filter((b) => b.data === null).map(() => 'a block that is not JSON'),
  ...p.jsonLd.flatMap((b) => schemaProblems(b.data)).map((x) => `${x.type} lacks ${x.missing}`),
];

/** Each summary row: a label and a counter over a run's pages. */
const SUMMARY: readonly [label: string, count: (run: AuditRun, origin: string) => number][] = [
  ['URLs in the sitemap', (r) => r.sitemap.length],
  ['answering other than 200', (r) => r.pages.filter((p) => p.status !== 200).length],
  ['not exactly one H1', (r) => r.pages.filter((p) => p.h1.length !== 1).length],
  [
    'a skipped heading level',
    (r) => r.pages.filter((p) => skippedHeadings(p.headings).length > 0).length,
  ],
  ['canonical not the page itself', (r, o) => r.pages.filter((p) => !canonicalIsSelf(p, o)).length],
  ['no meta description', (r) => r.pages.filter((p) => p.descriptions.length === 0).length],
  [
    'more than one meta description',
    (r) => r.pages.filter((p) => p.descriptions.length > 1).length,
  ],
  [
    'description outside 70–160 characters',
    (r) =>
      r.pages.filter((p) => p.descriptions.some((d) => d.length < 70 || d.length > 160)).length,
  ],
  [
    'description shared with another page',
    (r) => {
      const seen = new Map<string, number>();
      for (const p of r.pages) for (const d of p.descriptions) seen.set(d, (seen.get(d) ?? 0) + 1);
      return r.pages.filter((p) => p.descriptions.some((d) => seen.get(d)! > 1)).length;
    },
  ],
  ['title over 60 characters', (r) => r.pages.filter((p) => (p.title ?? '').length > 60).length],
  ['an image without alt', (r) => r.pages.filter((p) => p.imagesWithoutAlt.length > 0).length],
  ['noindex', (r) => r.pages.filter((p) => isNoindex(p.robots)).length],
  ['a JSON-LD problem', (r) => r.pages.filter((p) => jsonLdProblems(p).length > 0).length],
  [
    'FAQPage questions not shown on the page',
    (r) => r.pages.filter((p) => p.faqNotVisible.length > 0).length,
  ],
  [
    'no internal link to it from another sitemap page',
    (r) => r.pages.filter((p) => inLinks(r, p.path).length === 0).length,
  ],
];

function summary(input: ReportInput): string[] {
  const cols: [string, AuditRun][] = [
    ...(input.before
      ? ([
          ['before, flags off', input.before.off],
          ['before, flags on', input.before.on],
        ] as [string, AuditRun][])
      : []),
    [input.before ? 'now, flags off' : 'flags off', input.off],
    [input.before ? 'now, flags on' : 'flags on', input.on],
  ];
  return [
    `| Pages with … | ${cols.map((c) => c[0]).join(' | ')} |`,
    `| --- | ${cols.map(() => '---:').join(' | ')} |`,
    ...SUMMARY.map(
      ([label, count]) =>
        `| ${label} | ${cols.map((c) => count(c[1], input.origin)).join(' | ')} |`,
    ),
  ];
}

function attribution(input: ReportInput, run: AuditRun): Map<string, string[]> {
  const byPath = new Map(input.posts.map((p) => [`/blog/${p.slug}`, p]));
  const pages: AttributablePage[] = run.pages.map((p) => {
    const post = byPath.get(p.path);
    if (post) return { path: p.path, terms: [post.slug, post.title, ...post.keywords] };
    const title = (p.title ?? '').replace(TITLE_SUFFIX, '');
    return { path: p.path, terms: [p.path, title, ...(p.path === '/' ? ['crawlmouse'] : [])] };
  });
  const out = new Map<string, string[]>();
  for (const [path, rows] of attributeQueries(QUERIES, pages)) {
    out.set(
      path,
      rows.slice(0, 3).map((r) => `${r[0]} (${r[2]})`),
    );
  }
  return out;
}

function pageTable(input: ReportInput, run: AuditRun): string[] {
  const queries = attribution(input, run);
  const gsc = new Map(PAGES.map((r) => [r[0], r]));
  return [
    '| Page | Status | Title | Desc. | H1 | Skips | Canonical | Robots | JSON-LD | In / out | Words | No alt | Impr. | Clicks | Pos. | Top queries (attributed, impressions) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...run.pages.map((p) => {
      const g = gsc.get(p.path);
      const problems = jsonLdProblems(p);
      const types = jsonLdTypes(p).join(', ') || '—';
      return [
        p.path,
        p.status,
        (p.title ?? '').length,
        p.descriptions.map((d) => d.length).join(' + ') || '—',
        p.h1.length,
        skippedHeadings(p.headings)
          .map((s) => `h${s.from.level}→h${s.to.level}`)
          .join(' ') || '0',
        canonicalIsSelf(p, input.origin) ? 'self' : p.canonicals.join(' ') || '—',
        p.robots.join('; ') || '—',
        problems.length ? `${types} ✗ ${problems.join('; ')}` : types,
        `${inLinks(run, p.path).length} / ${new Set(p.links).size}`,
        p.wordCount,
        p.imagesWithoutAlt.length,
        g ? g[2] : 0,
        g ? g[1] : 0,
        g ? g[3] : '—',
        (queries.get(p.path) ?? []).join('; ') || '—',
      ]
        .map((v) => cell(String(v)))
        .join(' | ')
        .replace(/^/, '| ')
        .concat(' |');
    }),
  ];
}

function textTable(run: AuditRun): string[] {
  return [
    '| Page | Title | Meta description | H1 |',
    '| --- | --- | --- | --- |',
    ...run.pages.map(
      (p) =>
        `| ${cell(p.path)} | ${cell(p.title ?? '—')} | ${cell(p.descriptions.join(' ‖ ') || '—')} | ${cell(p.h1.join(' ‖ ') || '—')} |`,
    ),
  ];
}

const range = (xs: number[]) => (xs.length ? `${Math.min(...xs)}–${Math.max(...xs)}` : '—');

/** Why a listed post may not be indexed: each measured factor, against the indexed posts' range. */
function notIndexed(input: ReportInput): string[] {
  const indexed = new Set(INDEXED);
  const out: string[] = [];
  for (const [label, run] of [
    ['flags off', input.off],
    ['flags on', input.on],
  ] as const) {
    const posts = run.pages.filter((p) => isPost(p.path));
    const isIn = (p: SavedPage) => indexed.has(`${p.path}`);
    const ins = posts.filter(isIn);
    const outs = posts.filter((p) => !isIn(p));
    out.push(
      `### ${label}: ${outs.length} sitemap post${outs.length === 1 ? '' : 's'} not in the indexed list`,
      '',
    );
    if (outs.length === 0) continue;
    const inLinkCounts = ins.map((p) => inLinks(run, p.path).length);
    const words = ins.map((p) => p.wordCount);
    const sims = ins.map((p) => p.nearest?.jaccard ?? 0);
    const published = new Map(input.posts.map((p) => [`/blog/${p.slug}`, p.publishedAt]));
    out.push(
      `Indexed posts, for comparison (${ins.length}): in-links ${range(inLinkCounts)}; words ${range(words)}; nearest-post similarity ${range(sims.map((s) => Math.round(s * 1000) / 1000))}.`,
      '',
      "| Post | Published | Canonical | In-links (from) | Words | Nearest post (5-gram Jaccard) | Outside the indexed posts' range |",
      '| --- | --- | --- | --- | ---: | --- | --- |',
    );
    for (const p of outs) {
      const from = inLinks(run, p.path);
      const flags = [
        !canonicalIsSelf(p, input.origin) && 'canonical is not self',
        isNoindex(p.robots) && 'noindex',
        from.length < Math.min(...inLinkCounts) && 'fewer in-links',
        p.wordCount < Math.min(...words) && 'fewer words',
        (p.nearest?.jaccard ?? 0) > Math.max(...sims) && `more alike to ${p.nearest!.path}`,
      ].filter(Boolean);
      out.push(
        `| ${p.path} | ${published.get(p.path) ?? '—'} | ${canonicalIsSelf(p, input.origin) ? 'self' : cell(p.canonicals.join(' '))} | ${from.length} (${cell(from.join(', '))}) | ${p.wordCount} | ${p.nearest ? `${p.nearest.path} (${p.nearest.jaccard})` : '—'} | ${flags.join('; ') || 'none of the measured factors'} |`,
      );
    }
    out.push('');
  }
  return out;
}

function surfaceCell(s: AuditRun['surfaces'][number]): string {
  if (s.status >= 300 && s.status < 400) return `${s.status} → ${s.location ?? '?'}`;
  if (s.status === 200)
    return isNoindex(s.robots) ? `200, ${s.robots.join('; ')}` : '200, INDEXABLE';
  return String(s.status);
}

function surfaces(input: ReportInput): string[] {
  const on = new Map(input.on.surfaces.map((s) => [s.path, s]));
  const indexable = [input.off, input.on].flatMap((r) =>
    r.surfaces
      .filter((s) => s.status === 200 && !isNoindex(s.robots))
      .map((s) => `${s.path} (${r.label})`),
  );
  return [
    indexable.length === 0
      ? 'No app surface answers an indexable page in either build: each is noindex, a redirect, or not found.'
      : `App surfaces answering an indexable page: ${indexable.join(', ')}.`,
    '',
    '| Path | flags off | flags on |',
    '| --- | --- | --- |',
    ...input.off.surfaces.map(
      (s) =>
        `| ${s.path} | ${cell(surfaceCell(s))} | ${cell(on.has(s.path) ? surfaceCell(on.get(s.path)!) : '—')} |`,
    ),
  ];
}

function www(input: ReportInput): string[] {
  if (!input.www) return ['Not checked in this run.'];
  const { status, location, checkedAt } = input.www;
  const apex = `${input.origin}/`;
  const verdict =
    (status === 301 || status === 308) && location === apex
      ? `one ${status} to ${apex}: not separately indexable`
      : `${status}${location ? ` → ${location}` : ''}: NOT a single permanent redirect to ${apex}`;
  return [
    `\`https://www.${new URL(input.origin).host}/\` answered ${verdict} (read ${checkedAt}).`,
  ];
}

export function renderReport(input: ReportInput): string {
  const run = (r: AuditRun) => `${r.label}: commit \`${r.sha.slice(0, 8)}\`, read ${r.takenAt}`;
  return [
    '# Public page audit',
    '',
    '_Rendered by `scripts/seo/audit.ts --render` from the runs in `docs/seo/audit-data/`. Do not edit by hand._',
    '',
    `- ${run(input.off)}`,
    `- ${run(input.on)}`,
    ...(input.before
      ? [`- before: ${run(input.before.off)}`, `- before: ${run(input.before.on)}`]
      : []),
    `- Search Console export of ${EXPORTED_AT} (indexed list as of ${INDEXED_AS_OF}). Queries are attributed to pages by word match (\`lib/seo/attribution.ts\`): the export has no page × query table.`,
    '',
    'Re-run:',
    '',
    '```bash',
    ...input.commands,
    '```',
    '',
    '## Summary',
    '',
    ...summary(input),
    '',
    '## Indexing: posts not in the indexed list',
    '',
    ...notIndexed(input),
    '## App surfaces',
    '',
    ...surfaces(input),
    '',
    '## www',
    '',
    ...www(input),
    '',
    ...(['off', 'on'] as const).flatMap((k) => {
      const r = input[k];
      return [
        `## Pages, ${r.label}`,
        '',
        ...pageTable(input, r),
        '',
        `### Titles, descriptions and H1s, ${r.label}`,
        '',
        ...textTable(r),
        '',
      ];
    }),
  ].join('\n');
}
