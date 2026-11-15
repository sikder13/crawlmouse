/**
 * The technical SEO rules every public page is held to (CC-40 D3), over what a crawler reads: the
 * page's head (`PageHead`) and its rendered body (`PageFacts`). The same rules serve the D3 test,
 * which builds the head from a route's own `Metadata` (`headFromMetadata`), and the page audit, which
 * reads the head a running build served (`headFromFacts`).
 *
 * A rule here names what it checks and nothing else; which pages are excused from which rule, and
 * why, is data in `page-exceptions.ts`. Relative imports only: the audit script loads this file by
 * path from outside apps/web.
 */
import type { Metadata } from 'next';
import {
  hiddenFaqQuestions,
  skippedHeadings,
  typedNodes,
  typesOf,
  type PageFacts,
} from './page-facts';
import { isNoindex } from './audit-run';
import { schemaProblems } from './schema-required';

export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;

export type RuleId =
  | 'h1-count'
  | 'heading-skip'
  | 'canonical-not-self'
  | 'title-missing'
  | 'title-length'
  | 'description-missing'
  | 'description-multiple'
  | 'description-length'
  | 'description-duplicate'
  | 'image-alt'
  | 'noindex'
  | 'article-date-modified'
  | 'breadcrumb-missing'
  | 'faq-not-visible'
  | 'jsonld-schema'
  | 'link-not-live'
  | 'no-in-link'
  | 'too-deep';

export interface Violation {
  path: string;
  rule: RuleId;
  detail: string;
}

/** The head fields the rules read, as the tags a crawler sees would carry them. */
export interface PageHead {
  title: string | null;
  descriptions: string[];
  /** Absolute canonical URLs. */
  canonicals: string[];
  robots: string[];
}

export interface RuleContext {
  /** The production origin canonicals name, e.g. https://crawlmouse.com. */
  origin: string;
  /** Paths that answer 200 in this build: an internal link to anything else fails. */
  live: ReadonlySet<string>;
  /** Pages that earn search impressions: a long title there is reported, not failed (§13). */
  earnsImpressions: (path: string) => boolean;
  /** A page whose canonical is deliberately another page: path → that page's path. */
  canonicalTargets: Readonly<Record<string, string>>;
}

/** Posts, the guides hub, the research page, author pages and the help centre carry a BreadcrumbList. */
export function needsBreadcrumb(path: string): boolean {
  return (
    /^\/blog\/[^/]+$/.test(path) ||
    /^\/authors\/[^/]+$/.test(path) ||
    /^\/help(\/[^/]+)?$/.test(path) ||
    path === '/guides'
  );
}

/** The URL a page's canonical must name: its own, or its documented target. */
function expectedCanonicals(path: string, ctx: RuleContext): string[] {
  const target = Object.hasOwn(ctx.canonicalTargets, path) ? ctx.canonicalTargets[path]! : path;
  return target === '/' ? [ctx.origin, `${ctx.origin}/`] : [`${ctx.origin}${target}`];
}

export function pageViolations(
  page: { path: string; head: PageHead; body: PageFacts },
  ctx: RuleContext,
): { violations: Violation[]; reported: Violation[] } {
  const { path, head, body } = page;
  const violations: Violation[] = [];
  const reported: Violation[] = [];
  const fail = (rule: RuleId, detail: string) => violations.push({ path, rule, detail });

  if (body.h1.length !== 1) fail('h1-count', `${body.h1.length} H1 elements`);
  for (const s of skippedHeadings(body.headings))
    fail('heading-skip', `h${s.from.level} "${s.from.text}" → h${s.to.level} "${s.to.text}"`);

  const expected = expectedCanonicals(path, ctx);
  if (head.canonicals.length !== 1 || !expected.includes(head.canonicals[0]!))
    fail('canonical-not-self', head.canonicals.length ? head.canonicals.join(' ') : 'none');

  if (head.title === null || head.title === '') fail('title-missing', 'no title');
  else if (head.title.length > TITLE_MAX) {
    const v: Violation = {
      path,
      rule: 'title-length',
      detail: `${head.title.length} characters: ${head.title}`,
    };
    (ctx.earnsImpressions(path) ? reported : violations).push(v);
  }

  if (head.descriptions.length === 0) fail('description-missing', 'no meta description');
  else if (head.descriptions.length > 1)
    fail('description-multiple', `${head.descriptions.length} meta descriptions`);
  else {
    const n = head.descriptions[0]!.length;
    if (n < DESCRIPTION_MIN || n > DESCRIPTION_MAX) fail('description-length', `${n} characters`);
  }

  for (const src of body.imagesWithoutAlt) fail('image-alt', src || '(no src)');
  if (isNoindex(head.robots)) fail('noindex', head.robots.join(' | '));

  const nodes = body.jsonLd.flatMap((b) => typedNodes(b.data));
  const isArticle = (n: Record<string, unknown>) => typesOf(n).includes('Article');
  for (const n of nodes.filter(isArticle))
    if (n.dateModified === undefined || n.dateModified === null || n.dateModified === '')
      fail('article-date-modified', String(n.headline ?? 'Article'));
  if (needsBreadcrumb(path) && !nodes.some((n) => typesOf(n).includes('BreadcrumbList')))
    fail('breadcrumb-missing', 'no BreadcrumbList');
  for (const q of hiddenFaqQuestions(body)) fail('faq-not-visible', q || '(unnamed question)');

  for (const b of body.jsonLd) {
    if (b.data === null) {
      fail('jsonld-schema', 'a block that is not JSON');
      continue;
    }
    for (const p of schemaProblems(b.data)) {
      // Reported by its own rule above.
      if (p.type === 'Article' && p.missing === 'dateModified') continue;
      fail('jsonld-schema', `${p.type} lacks ${p.missing}`);
    }
  }

  for (const target of new Set(body.links))
    if (!ctx.live.has(target)) fail('link-not-live', target);

  return { violations, reported };
}

/** Rules across a build's pages: a meta description that two pages share fails on each. */
export function siteViolations(pages: readonly { path: string; head: PageHead }[]): Violation[] {
  const byText = new Map<string, string[]>();
  for (const p of pages)
    for (const d of new Set(p.head.descriptions)) byText.set(d, [...(byText.get(d) ?? []), p.path]);
  const out: Violation[] = [];
  for (const p of pages) {
    const others = new Set(
      p.head.descriptions.flatMap((d) => byText.get(d)!.filter((q) => q !== p.path)),
    );
    if (others.size)
      out.push({
        path: p.path,
        rule: 'description-duplicate',
        detail: `also on ${[...others].join(', ')}`,
      });
  }
  return out;
}

/** A bound on click depth: pages whose path matches `pattern` are at most `clicks` from `from`. */
export interface DepthBound {
  from: string;
  pattern: RegExp;
  clicks: number;
}

/** Clicks from `from` to each page it reaches, following the links between the build's pages. */
function clicksFrom(pages: readonly { path: string; links: readonly string[] }[], from: string) {
  const out = new Map<string, number>([[from, 0]]);
  const linksOf = new Map(pages.map((p) => [p.path, p.links]));
  let frontier = [from];
  for (let d = 1; frontier.length; d += 1) {
    const next: string[] = [];
    for (const path of frontier)
      for (const to of linksOf.get(path) ?? [])
        if (linksOf.has(to) && !out.has(to)) {
          out.set(to, d);
          next.push(to);
        }
    frontier = next;
  }
  return out;
}

/**
 * Rules over the links between a build's pages: a page that no other page links to (the `root`
 * aside) fails `no-in-link`; a page a `within` bound covers fails `too-deep` when it is further than
 * the bound's clicks from its start, or not reached from it at all.
 */
export function linkViolations(
  pages: readonly { path: string; links: readonly string[] }[],
  args: { root: string; within: readonly DepthBound[] },
): Violation[] {
  const out: Violation[] = [];
  for (const p of pages) {
    if (p.path === args.root) continue;
    if (!pages.some((q) => q.path !== p.path && q.links.includes(p.path)))
      out.push({
        path: p.path,
        rule: 'no-in-link',
        detail: 'no other page in the build links here',
      });
  }
  for (const bound of args.within) {
    const depth = clicksFrom(pages, bound.from);
    for (const p of pages.filter((x) => bound.pattern.test(x.path) && x.path !== bound.from)) {
      const d = depth.get(p.path);
      if (d === undefined)
        out.push({ path: p.path, rule: 'too-deep', detail: `not reached from ${bound.from}` });
      else if (d > bound.clicks)
        out.push({
          path: p.path,
          rule: 'too-deep',
          detail: `${d} clicks from ${bound.from} (at most ${bound.clicks})`,
        });
    }
  }
  return out;
}

/** The head a served page carried, from its facts. */
export function headFromFacts(facts: PageFacts): PageHead {
  return {
    title: facts.title,
    descriptions: facts.descriptions,
    canonicals: facts.canonicals,
    robots: facts.robots,
  };
}

type TitleField = Metadata['title'];

/** A page title as the tag reads, given the page's field and the root layout's. */
function resolveTitle(page: TitleField, layout: TitleField): string | null {
  const template =
    layout && typeof layout === 'object' && 'template' in layout ? layout.template : null;
  const layoutDefault =
    typeof layout === 'string' ? layout : layout && 'default' in layout ? layout.default : null;
  if (page === undefined || page === null) return layoutDefault ?? null;
  if (typeof page === 'string') return template ? template.replace('%s', page) : page;
  if ('absolute' in page && page.absolute) return page.absolute;
  if ('default' in page && page.default) return page.default;
  return layoutDefault ?? null;
}

function robotsText(robots: Metadata['robots']): string[] {
  if (robots === undefined || robots === null) return [];
  if (typeof robots === 'string') return [robots];
  const parts: string[] = [];
  if (robots.index !== undefined) parts.push(robots.index ? 'index' : 'noindex');
  if (robots.follow !== undefined) parts.push(robots.follow ? 'follow' : 'nofollow');
  return parts.length ? [parts.join(', ')] : [];
}

function canonicalOf(alternates: Metadata['alternates']): string | null {
  const c = alternates?.canonical;
  if (c === undefined || c === null) return null;
  if (typeof c === 'string') return c;
  if (c instanceof URL) return c.href;
  return typeof c.url === 'string' ? c.url : c.url.href;
}

/**
 * The head a route's own `Metadata` gives its page, each field the page leaves unset taken from the
 * root layout's: the title through the layout's template, the description, the canonical (resolved
 * against `origin`, as `metadataBase` does) and robots. This is how Next fills those four fields; it
 * is not the whole head merge (Open Graph, images and the rest are not modelled), which the page audit
 * reads from a running build instead.
 */
export function headFromMetadata(page: Metadata, layout: Metadata, origin: string): PageHead {
  const description = page.description ?? layout.description ?? null;
  const canonical = canonicalOf(page.alternates) ?? canonicalOf(layout.alternates);
  return {
    title: resolveTitle(page.title, layout.title),
    descriptions: description ? [description] : [],
    canonicals: canonical ? [new URL(canonical, origin).href] : [],
    robots: robotsText(page.robots !== undefined ? page.robots : layout.robots),
  };
}
