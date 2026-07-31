import type { AiReadinessScore, AiPageClass, AiFinding, AiBotAccess } from '@crawlmouse/types';
import type { BadgeTone } from '../ui/Badge';

/** The overall band -> a client-explainable label + a Badge tone. Never a ranking claim (A16). */
export function bandMeta(band: AiReadinessScore['band']): { label: string; tone: BadgeTone } {
  switch (band) {
    case 'ready':
      return { label: 'AI-ready', tone: 'success' };
    case 'partial':
      return { label: 'Partly ready', tone: 'info' };
    case 'at_risk':
      return { label: 'At risk', tone: 'warning' };
    default:
      // Unreachable for a live engine object, but this ALSO reads FROZEN `/r/` report snapshots, which
      // outlive the code that wrote them and can never be migrated (minted-snapshot immutability). With
      // no fallback, renaming a band in a later spec would permanently 500 every already-minted public,
      // indexable report instead of degrading. Mirrors SPEC 04's `findingMeta` fallback on the same artifact.
      return { label: 'Not rated', tone: 'neutral' };
  }
}

/** Per-page AI-legibility class -> label + tone + a plain-language meaning (honest, reachability-framed). */
export function pageClassMeta(cls: AiPageClass): { label: string; tone: BadgeTone; meaning: string } {
  switch (cls) {
    case 'readable':
      return { label: 'Readable', tone: 'success', meaning: 'AI crawlers see this page in full without running JavaScript.' };
    case 'partial':
      return { label: 'Partial', tone: 'info', meaning: 'Only part of this page is in the static HTML; the rest loads with JavaScript.' };
    case 'js_blind':
      return { label: 'JavaScript-blind', tone: 'warning', meaning: 'This page renders with JavaScript, so a non-rendering AI crawler sees an empty page.' };
    case 'thin':
      return { label: 'Thin', tone: 'neutral', meaning: 'This page has very little text — fine for a contact/landing page.' };
  }
}

/** The honesty label rendered next to a finding (§2 evidence discipline). */
export function evidenceLabel(evidence: AiFinding['evidence']): string {
  switch (evidence) {
    case 'strong':
      return 'Strong evidence';
    case 'moderate':
      return 'Moderate evidence';
    case 'contested':
      return 'Contested / mixed evidence';
    case 'informational':
      return 'Informational';
  }
}

export interface ComponentBar {
  key: 'access' | 'content' | 'legibility' | 'retrieval';
  label: string;
  pct: number; // 0..100, rounded at the render boundary
  weight: number;
}

/**
 * The four weighted component sub-scores as render-ready bars (LOCKED weights 25/40/20/15).
 * Takes the `components` block structurally, not a whole `AiReadinessScore`, so the audit page's live
 * engine object and the `/r/` report's frozen snapshot projection can both use it unchanged.
 */
export function componentBars(score: Pick<AiReadinessScore, 'components'>): ComponentBar[] {
  const c = score.components;
  // Tolerant per-sub-component read. On the audit page this reads a live engine object and every field
  // is present; on `/r/` it reads a FROZEN snapshot that outlives this code and can never be migrated,
  // so a later spec renaming or dropping one sub-score must yield a missing BAR, not a thrown render
  // that permanently 500s an indexed public report.
  const bar = (
    key: ComponentBar['key'],
    label: string,
    part: { score: number; weight: number } | undefined,
  ): ComponentBar | null =>
    part && typeof part.score === 'number'
      ? { key, label, pct: Math.round(part.score * 100), weight: part.weight }
      : null;
  return [
    bar('access', 'AI crawler access', c?.access),
    bar('content', 'Content without JavaScript', c?.contentWithoutJs),
    bar('legibility', 'Machine legibility', c?.machineLegibility),
    bar('retrieval', 'Retrieval path', c?.retrievalPath),
  ].filter((b): b is ComponentBar => b !== null);
}

/**
 * Partition retrieval-class bots by whether they can reach the site — returned TOGETHER, from one
 * function, deliberately.
 *
 * THE DEFECT THIS REPLACES. `blockedRetrievalBots` returned only the restricted bots, and the result
 * page rendered that list under the heading "Who can reach your content". So on a site where
 * OAI-SearchBot, ChatGPT-User and PerplexityBot are fully blocked, those three were listed as the
 * reachers — while findings on the SAME screen said each "can reach only 0% of your pages". The score
 * and the findings were right; the card contradicted both. A product that disagrees with itself on one
 * screen is worse than one that says nothing.
 *
 * Returning both groups from a single partition makes them MUTUALLY EXCLUSIVE BY CONSTRUCTION: a bot
 * cannot appear in both, the two lists cannot drift apart, and neither can be rendered under the
 * other's heading by picking the wrong helper — there is now only one helper.
 *
 * `canReach` requires ratio >= 1. A partially-blocked bot cannot reach your content; it reaches SOME of
 * it, and its note states the share. Anything short of full access belongs in `blocked`, so a bot at
 * ratio 0 can never be presented as a reacher.
 */
export function partitionRetrievalBots(bots: AiBotAccess[]): { canReach: AiBotAccess[]; blocked: AiBotAccess[] } {
  const retrieval = bots.filter((b) => b.botClass === 'retrieval');
  return {
    canReach: retrieval.filter((b) => b.allowedPageRatio >= 1),
    blocked: retrieval.filter((b) => b.allowedPageRatio < 1),
  };
}

/**
 * The one-line summary for a COLLAPSED finding row.
 *
 * Collapsed rows used to render `targetTitle ?? targetUrl ?? 'Site-wide'`, so every site-level finding
 * showed a bare "Site-wide" carrying no information until expanded — and on a site with three blocked
 * retrieval bots that is three IDENTICAL rows, which reads like a rendering bug. Measured on real
 * production data, the distinguishing detail lives in `plainLanguage`:
 *
 *   "OpenAI's OAI-SearchBot can reach only 0% of your pages — blocking a search/citation crawler…"
 *   "Perplexity's PerplexityBot can reach only 0% of your pages — blocking a search/citation crawler…"
 *
 * …while for PAGE-level findings `plainLanguage` is generic ("This page has very little text…") and the
 * TITLE is what distinguishes one row from another. So the summary is the leading clause of the finding
 * text, plus the target when there is one — informative in both shapes, and no new copy to drift.
 */
export function findingSummary(f: Pick<AiFinding, 'plainLanguage' | 'targetTitle' | 'targetUrl'>): string {
  const text = (f.plainLanguage ?? '').trim();
  // Leading clause: up to the first sentence end or em-dash aside, whichever comes first.
  const cut = text.search(/(?:\.\s)|(?:\s—\s)/);
  let head = (cut > 0 ? text.slice(0, cut) : text).replace(/[.\s]+$/, '');
  // CODE-POINT-aware truncation. A raw `head.slice(0, 95)` splits a surrogate pair mid-character, which
  // renders as a replacement glyph; `Array.from` iterates by code point, so an ARRAY slice cannot split
  // one. The engine's shared `toPersistableText` would be the usual answer, but this module is imported
  // by a `'use client'` component and pulling the engine barrel into the client bundle is the A9 defect.
  const chars = Array.from(head);
  if (chars.length > 96) head = `${chars.slice(0, 95).join('').trimEnd()}…`;
  const where = f.targetTitle ?? f.targetUrl ?? null;
  if (!head) return where ?? 'Site-wide';
  return where ? `${head} — ${where}` : head;
}
