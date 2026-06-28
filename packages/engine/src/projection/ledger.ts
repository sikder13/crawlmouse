import type { FindingCategory } from '@crawlmouse/types';
import type { SiteGraph } from '../graph.js';
import type { GraphAnalysis } from '../grade-inputs.js';
import type { Corpus } from './relevance.js';
import { MAX_HEALTHY_DEPTH, ANCHOR_HHI_ALERT, GENERIC_ANCHOR_ALERT } from '../constants.js';
import { sameHostIgnoringWww } from '../extract.js';

export interface SuggestedLink {
  fromUrl: string;
  fromTitle: string | null;
  anchorText: string;
  relevanceScore: number;
}

/**
 * A fix enumerated from the graded graph, with its deterministic prescription (suggested inbound
 * links). `marginalDelta` and the action-packet are added downstream (projection / action-packet).
 * `suggestedLinks` is empty ONLY for the site-wide `generic_anchor_overuse` advisory.
 */
export interface PrescribableFix {
  id: string; // `${category}:${targetUrl}` — stable across re-audits so monitoring can match.
  category: FindingCategory;
  targetUrl: string;
  targetTitle: string | null;
  effort: 'low' | 'medium' | 'high';
  rationale: string;
  suggestedLinks: SuggestedLink[];
}

export interface EnumerateFixesOptions {
  homepageUrl: string;
  isExcluded: (u: string) => boolean;
  corpus: Corpus;
  linksPerFix: number;
}

/** Generic anchor phrases a cure must never emit (mirrors the engine's generic-anchor detection). */
const GENERIC_ANCHORS = new Set([
  'click here', 'click', 'here', 'read more', 'read', 'learn more', 'more', 'this', 'this page',
  'this link', 'link', 'go', 'continue', 'continue reading', 'details', 'view', 'view more', 'page',
  'website', 'home', 'visit', 'see more',
]);

function nodeTitle(graph: SiteGraph, url: string): string | null {
  return graph.hasNode(url) ? graph.getNodeAttribute(url, 'title') ?? null : null;
}

/** SPEC 02 defense-in-depth: a fix target/source must be on the user's site (SPEC 01 §2 host rule). */
function isSameHost(u: string, homepageUrl: string): boolean {
  try {
    return sameHostIgnoringWww(new URL(u), new URL(homepageUrl));
  } catch {
    return false;
  }
}

/** Collapse whitespace, strip control chars, trim, length-cap — a clean single-line phrase. */
function cleanInline(s: string, cap = 120): string {
  return s.replace(/[\s\x00-\x1f]+/g, ' ').trim().slice(0, cap);
}

/** Low-signal slug tokens that make for poor anchors (plus bare numbers, filtered separately). */
const SLUG_NOISE = new Set(['index', 'html', 'htm', 'category', 'catalogue', 'page']);

function slugPhrase(url: string): string {
  try {
    const raw = cleanInline(new URL(url).pathname.replace(/[/_\-.]+/g, ' '));
    return raw
      .split(' ')
      .filter((w) => w.length >= 2 && !SLUG_NOISE.has(w.toLowerCase()) && !/^\d+$/.test(w))
      .join(' ');
  } catch {
    return '';
  }
}

/**
 * The page-specific title for anchors/rationale: strip the common site-name suffix
 * ("Page | Site" / "Page – Site" / "Page — Site" → "Page") — the dominant WordPress/Shopify pattern —
 * so a generated anchor reads as the page topic, not the brand. Falls back to the full title.
 */
function cleanTitle(raw: string | null): string {
  const first = (raw ?? '').split(/\s*[|–—]\s*/)[0]?.trim() ?? '';
  return cleanInline(first || raw || '');
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Deterministic, VARIED, non-generic anchor candidates describing the target. Variety matters: K
 * inbound links all using the identical anchor is itself the over-optimization we penalize, so the
 * cure must not create one. The anchor is a seed — the action-packet tells the user's LLM to
 * naturalize it. Quality here is a tunable heuristic (titles+slug only; headings later).
 */
function anchorVariants(targetUrl: string, targetTitle: string | null, avoid: Set<string>): string[] {
  const titleClean = cleanTitle(targetTitle);
  const slug = slugPhrase(targetUrl);
  const words = titleClean.split(/\s+/).filter((w) => w.length >= 2);

  const candidates: string[] = [];
  if (titleClean) candidates.push(titleClean);
  if (words.length >= 3) candidates.push(words.slice(0, 3).join(' '));
  if (slug && slug.toLowerCase() !== titleClean.toLowerCase()) candidates.push(titleCase(slug));
  if (words.length >= 2) candidates.push(`${words[0]} ${words[words.length - 1]}`);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const t = cleanInline(c, 80);
    const key = t.toLowerCase();
    // Never emit a generic anchor, nor one already over-used pointing at this target (`avoid`) — for
    // an over_optimized_anchor fix that would echo the very anchor we're trying to dilute.
    if (t && !seen.has(key) && !GENERIC_ANCHORS.has(key) && !avoid.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  if (out.length === 0) {
    const fb = (slug && !avoid.has(slug.toLowerCase())) ? titleCase(slug) : 'related resource';
    out.push(fb);
  }
  return out;
}

/** Rank eligible source pages for `target` by (relevance desc, url asc) and prescribe up to K links. */
function prescribe(
  graph: SiteGraph,
  target: string,
  opts: EnumerateFixesOptions,
  eligible: (source: string) => boolean,
): SuggestedLink[] {
  const targetTitle = nodeTitle(graph, target);
  // Anchors already over-used pointing AT the target — never re-suggest them (for an
  // over_optimized_anchor fix that would echo the very anchor we are trying to dilute).
  const avoid = new Set<string>();
  graph.forEachInEdge(target, (_e, attrs) => {
    const a = (attrs.anchorText ?? '').trim().toLowerCase();
    if (a) avoid.add(a);
  });
  const ranked = graph
    .nodes()
    .filter((s) => s !== target && !opts.isExcluded(s) && !graph.hasEdge(s, target) && eligible(s) && isSameHost(s, opts.homepageUrl))
    .map((s) => ({ s, score: opts.corpus.relevance(s, target) }))
    .sort((a, b) => (b.score - a.score) || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0))
    .slice(0, opts.linksPerFix);

  const variants = anchorVariants(target, targetTitle, avoid);
  return ranked.map((r, i) => ({
    fromUrl: r.s,
    fromTitle: nodeTitle(graph, r.s),
    anchorText: variants[i % variants.length]!,
    relevanceScore: r.score,
  }));
}

/**
 * §3 enumerate fixable issues from the graded graph + its `GraphAnalysis` intermediates, each with a
 * deterministic prescription. Categories: orphan, under_linked_important (near-orphan ∩ high
 * PageRank), deep_page (sources must be shallow so the link un-buries it), over_optimized_anchor, and
 * a single site-wide generic_anchor_overuse advisory (no per-link cure). Targets sorted by url asc
 * within each category; a fix with zero eligible sources is dropped (no throwaway fixes). Pure.
 */
export function enumerateFixes(graph: SiteGraph, ga: GraphAnalysis, opts: EnumerateFixesOptions): PrescribableFix[] {
  const { homepageUrl, isExcluded } = opts;
  const fixes: PrescribableFix[] = [];
  const asc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  const push = (category: FindingCategory, targetUrl: string, effort: PrescribableFix['effort'], rationale: string, eligible: (s: string) => boolean) => {
    if (!isSameHost(targetUrl, homepageUrl)) return; // never prescribe an off-site (cross-host) target
    const suggestedLinks = prescribe(graph, targetUrl, opts, eligible);
    if (suggestedLinks.length === 0) return; // drop fixes we can't actually prescribe
    fixes.push({ id: `${category}:${targetUrl}`, category, targetUrl, targetTitle: nodeTitle(graph, targetUrl), effort, rationale, suggestedLinks });
  };

  // 1) Orphans — add ANY relevant inbound link.
  for (const t of [...ga.filteredOrphans].sort(asc)) {
    const title = nodeTitle(graph, t);
    push('orphan', t, 'low', `No internal links point to ${quoted(title, t)}. Adding inbound links from related pages makes it discoverable and passes it link equity.`, () => true);
  }

  // 2) Deep pages — a SHALLOW source (depth < MAX_HEALTHY_DEPTH) so the link brings it within budget.
  const deepTargets = [...ga.depths.entries()]
    .filter(([u, d]) => d > MAX_HEALTHY_DEPTH && !isExcluded(u) && u !== homepageUrl)
    .map(([u]) => u)
    .sort(asc);
  for (const t of deepTargets) {
    const d = ga.depths.get(t)!;
    push('deep_page', t, 'medium', `${quoted(nodeTitle(graph, t), t)} is ${d} clicks from the homepage — too deep to be easily found. A link from a shallow hub page brings it closer.`,
      (s) => (ga.depths.get(s) ?? Infinity) < MAX_HEALTHY_DEPTH);
  }

  // 3) Under-linked important pages — near-orphan (inDegree 1–2), reachable + not too deep, above-mean PageRank.
  const ranks = ga.ranks;
  const meanRank = ranks.size > 0 ? [...ranks.values()].reduce((a, b) => a + b, 0) / ranks.size : 0;
  const underLinked = graph
    .nodes()
    .filter((u) => {
      if (u === homepageUrl || isExcluded(u)) return false;
      const inDeg = graph.inDegree(u);
      const d = ga.depths.get(u);
      return inDeg >= 1 && inDeg <= 2 && d !== undefined && d <= MAX_HEALTHY_DEPTH && (ranks.get(u) ?? 0) > meanRank;
    })
    .sort(asc);
  for (const t of underLinked) {
    push('under_linked_important', t, 'low', `${quoted(nodeTitle(graph, t), t)} is an important page (high authority) but has very few inbound links. More internal links from related pages would strengthen it.`, () => true);
  }

  // 4) Over-optimized anchors — a new, varied-anchor inbound link dilutes the concentration.
  const overOptimized = [...ga.hhiMap.entries()]
    .filter(([u, hhi]) => hhi > ANCHOR_HHI_ALERT && !isExcluded(u))
    .map(([u]) => u)
    .sort(asc);
  for (const t of overOptimized) {
    push('over_optimized_anchor', t, 'low', `Inbound links to ${quoted(nodeTitle(graph, t), t)} overuse the same anchor text, which reads as manipulative. Adding links with varied, natural anchors dilutes the concentration.`, () => true);
  }

  // 5) Site-wide generic-anchor overuse — an advisory diagnosis (no single target / no per-link cure).
  if (ga.genericAnchorFraction > GENERIC_ANCHOR_ALERT) {
    fixes.push({
      id: `generic_anchor_overuse:${homepageUrl}`,
      category: 'generic_anchor_overuse',
      targetUrl: homepageUrl,
      targetTitle: nodeTitle(graph, homepageUrl),
      effort: 'medium',
      rationale: `Too many internal links across the site use generic anchor text ("click here", "read more"). Replacing them with descriptive, keyword-relevant anchors helps search engines understand each target.`,
      suggestedLinks: [],
    });
  }

  return fixes;
}

/** Interpolate a (cleaned) title or fall back to the slug, always quoted, for the rationale string. */
function quoted(title: string | null, url: string): string {
  const t = cleanTitle(title);
  return `"${t || slugPhrase(url) || url}"`;
}
