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
  // `blocked` is the ELSE of `canReach`, not an independent `< 1` predicate. Two predicates left a gap:
  // a bot whose `allowedPageRatio` is NaN or missing satisfied NEITHER and vanished from both lists —
  // a silent under-report on exactly the drifted frozen snapshot this component is supposed to survive.
  // Framed this way the partition is TOTAL by construction: every retrieval bot lands in exactly one
  // group, and anything not provably full-reach is treated as restricted (the safe direction).
  const canReach = retrieval.filter((b) => b.allowedPageRatio >= 1);
  const reaching = new Set(canReach);
  return { canReach, blocked: retrieval.filter((b) => !reaching.has(b)) };
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
 * TITLE is what distinguishes one row from another. So the summary is the finding text plus the target
 * when there is one — informative in both shapes, and no new copy to drift.
 *
 * IT DOES NOT CUT AT A SENTENCE BOUNDARY, and that is the point. A first version cut at the first
 * `. ` or ` \u2014 `, which is abbreviation-blind: the shipped `heading_structure` copy is "This page skips
 * heading levels (e.g. H1 \u2192 H3), which weakens the machine-readable outline." and it rendered as
 * "This page skips heading levels (e.g \u2014 Race Days" — a broken fragment with an unclosed parenthesis,
 * on the conversion-critical free result page, and strictly WORSE than the bare label it replaced.
 * Bounding by length has no such class: there is no rule to get wrong, only a maximum.
 */
/** Reach share as a whole percent, or null when the frozen snapshot carries no usable number. */
export function reachPercent(bot: Pick<AiBotAccess, 'allowedPageRatio'>): number | null {
  const r = bot.allowedPageRatio;
  return typeof r === 'number' && Number.isFinite(r) ? Math.round(Math.min(Math.max(r, 0), 1) * 100) : null;
}

const SUMMARY_MAX_CHARS = 88;
const SCOPE_MAX_CHARS = 60;

/** Bound a display string by CODE POINTS. `Array.from` iterates code points, so an array slice cannot
 *  split a surrogate pair; the engine's shared helper is the usual answer but this module is imported by
 *  a `'use client'` component, and pulling the engine barrel into the client bundle is the A9 defect. */
function boundChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}\u2026` : text;
}

export function findingSummary(f: Pick<AiFinding, 'plainLanguage' | 'targetTitle' | 'targetUrl'>): string {
  // `String(...)` because a non-string on the deliberately unvalidated `audits.ai_readiness` jsonb would
  // otherwise throw on `.trim()` and take the whole result page down.
  const text = String(f.plainLanguage ?? '').trim();
  // `||` not `??`: an EMPTY targetTitle must fall through to the url, not render an empty row.
  const where = f.targetTitle || f.targetUrl || null;
  if (!text) return where ? boundChars(where, SCOPE_MAX_CHARS) : 'Site-wide';
  const head = boundChars(text, SUMMARY_MAX_CHARS);
  // SEPARATOR IS ' \u00b7 ', NOT AN EM DASH. The engine's own copy uses ' \u2014 ' inside finding text
  // ("...but nothing links to it \u2014 assistants may never find it"), so an em-dash separator made the
  // target read as a continuation of the sentence: "...nothing links to it \u2014 Orphan".
  return where ? `${head} \u00b7 ${boundChars(where, SCOPE_MAX_CHARS)}` : head;
}

