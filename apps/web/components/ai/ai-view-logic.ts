import type { AiReadinessScore, AiPageClass, AiFinding, AiBotAccess } from '@crawlmouse/types';
import type { BadgeTone } from '../ui/Badge';
// Relative, not `@/`: this module is unit-tested (repo convention), and `url-display` is dependency-free
// so it cannot drag the engine barrel into the client bundle (the A9 defect).
import { safeDecodeUrlForDisplay } from '../../lib/url-display';

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
 * TARGET is what distinguishes one row from another. So the summary is the finding text plus the target
 * when there is one — informative in both shapes, and no new copy to drift. Which target datum is the
 * distinguisher is NOT a free choice: see `displayPath` — it must be the url, never the crawled title.
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
  if (typeof r !== 'number' || !Number.isFinite(r)) return null;
  // ROUND — because the ENGINE rounds (`assemble.ts`), and a card quoting a different number from the
  // finding six lines below it is the worse failure. This was briefly `Math.floor`, on the reasoning
  // that rounding sends 299/300 to "Blocked or restricted — reaches 100% of your pages", which
  // contradicts itself on one line. That reasoning is right; flooring is still the wrong fix, because
  // `allowedPageRatio` is a binary double: `Math.floor(0.29 * 100)` is 28, not 29. Measured
  // exhaustively — 40 count-pairs up to 1000 pages understate by a full point, 20 inside the crawl cap.
  // A true number with odd edge phrasing beats a false one.
  //
  // KNOWN RESIDUAL, tracked as FU-12k: a bot at ratio in [0.995, 1) renders "reaches 100% of your pages"
  // under the "Blocked or restricted" heading. FU-12k retires it by computing the percentage ONCE from
  // the integer counts and flooring THAT — exact, so 418/419 gives 99 and no boundary is understated —
  // with this function reading that field instead of recomputing from the ratio.
  return Math.round(Math.min(Math.max(r, 0), 1) * 100);
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

/**
 * Bound the SCOPE from the middle, keeping both ends.
 *
 * Head-truncating the scope reintroduced the very defect this summary exists to remove. For PAGE-level
 * findings `plainLanguage` is generic by design, so the scope IS the distinguisher — and real sites
 * share long prefixes. Measured AT THE SHIPPED 60-code-point bound, head-truncation gives:
 *
 *   /collections/womens-road-running-shoes-and-trainers/products/aero-glide-{7,8,9}
 *      -> "/collections/womens-road-running-shoes-and-trainers/product[cut]"   3 rows, IDENTICAL
 *   "How to train for a marathon in twelve weeks, a complete guide, part {1,2,3}"
 *      -> "How to train for a marathon in twelve weeks, a complete gu[cut]"    3 rows, IDENTICAL
 *   /event/event/holmestrand-maraton-2027/register-friend/<uuid>/788  (REAL, audit 15a79871, 94 cp)
 *      -> the trailing registration id is GONE; the middle bound keeps "[cut]d705/788"
 *
 * Three such rows rendered byte-identical, and for a URL-only row it was strictly WORSE than the bare
 * label it replaced, which printed the whole URL. Keeping the tail is what makes `aero-glide-7`,
 * `part 3` and `/788` visible, and the tail is where a url or a numbered title carries its identity.
 *
 * IF YOU CHANGE WHAT FEEDS THIS, RE-CHECK ITS TEST VECTORS. Round 3's origin-strip shortened the
 * pinning url from 79 to 55 code points -- under the bound -- so this branch stopped executing and the
 * round-2 regression test silently stopped regressing, without ever failing.
 */
function boundScope(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = Math.ceil((max - 1) * 0.55);
  const tail = max - 1 - head;
  return `${chars.slice(0, head).join('').trimEnd()}\u2026${chars.slice(chars.length - tail).join('').trimStart()}`;
}

/**
 * The page a finding is about, as the shortest string that IDENTIFIES it.
 *
 * THE URL WINS OVER THE TITLE, and that ordering is the whole point.
 *
 * A first version preferred `targetTitle` because a human name reads better than a slug. Rendered against
 * production audit `15a79871` (racedays.run) that is measurably wrong: `targetTitle` is crawled `<title>`
 * copy and carries NO uniqueness guarantee, and this CMS emits the bare brand for most of the site —
 * **405 of the 500 persisted findings have the title "Racedays"**. Because `plainLanguage` is generic for
 * page-level findings, the row became [generic text] · [generic title]:
 *
 *   43 of the 100 delivered rows collapsed to TWO distinct strings —
 *     x34  "This page has 0 H1 headings (a clear outline uses exactly one). · Racedays"
 *     x9   "This page is missing its meta description — a basic signal every crawler reads. · Racedays"
 *
 * i.e. the exact "three identical rows" symptom H3 exists to remove, at eleven times the scale, on the
 * conversion-critical free result page. The 34 rows had 34 DISTINCT urls the whole time.
 *
 * A url path is unique per page BY CONSTRUCTION, so preferring it has no exception to relocate — where
 * "prefer the title unless it repeats" would need cross-row context this helper does not have, and is the
 * kind of cleverness that has already cost this fix two rounds. Measured on the same audit: 100/100 rows
 * distinct. The origin is stripped because it is identical on every row of a single-host crawl and would
 * otherwise eat 24 of the 60 scope characters; the full url still renders in the expanded body.
 */
function displayPath(raw: string): string | null {
  try {
    const u = new URL(raw);
    // DECODE — this is a human-facing crawled-URL surface, so the SPEC 04.2/04.3 rule applies: never let a
    // literal %XX reach a reader. Tolerant by construction (it never throws and never leaves a raw escape).
    return safeDecodeUrlForDisplay(u.pathname === '' ? '/' : `${u.pathname}${u.search}`);
  } catch {
    return null; // relative/garbage on unvalidated jsonb — the caller falls back to the raw string
  }
}

export function findingSummary(f: Pick<AiFinding, 'plainLanguage' | 'targetTitle' | 'targetUrl'>): string {
  // `String(...)` because a non-string on the deliberately unvalidated `audits.ai_readiness` jsonb would
  // otherwise throw on `.trim()` and take the whole result page down.
  const text = String(f.plainLanguage ?? '').trim();
  // `||` not `??` at each step: an EMPTY url or title must fall THROUGH, not render an empty row.
  // `String(...)` on every branch: returning a non-string here renders as
  // "Objects are not valid as a React child" and 500s the page. The adjacent line already
  // coerced `plainLanguage` for exactly this reason; the guard was asymmetric.
  const rawUrl = f.targetUrl ? String(f.targetUrl) : null;
  // Url first (see displayPath), then the raw url if it would not parse, then the title.
  const rawWhere = (rawUrl && displayPath(rawUrl)) || rawUrl || (f.targetTitle ? String(f.targetTitle) : null);
  const where = rawWhere == null ? null : String(rawWhere);
  if (!text) return where ? boundScope(where, SCOPE_MAX_CHARS) : 'Site-wide';
  const head = boundChars(text, SUMMARY_MAX_CHARS);
  // SEPARATOR IS ' \u00b7 ', NOT AN EM DASH. The engine's own copy uses ' \u2014 ' inside finding text
  // ("...but nothing links to it \u2014 assistants may never find it"), so an em-dash separator made the
  // target read as a continuation of the sentence: "...nothing links to it \u2014 Orphan".
  return where ? `${head} \u00b7 ${boundScope(where, SCOPE_MAX_CHARS)}` : head;
}

