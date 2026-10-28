/**
 * Every sentence the audit screens state about measured data, built from the data so it cannot name
 * something the data does not hold (OPERATING-RULES §10). Each function is pure and is tested at the
 * points where its wording changes.
 *
 * Vocabulary (FACTS I2): "blocked" only for `disallowed_by_robots` and `blocked_by_ua_rule`; a
 * challenge is a challenge, and the real crawler may pass it.
 */
import {
  VerdictSchema,
  type AccessCause,
  type Check,
  type CrawlerResult,
  type Fix,
  type Verdict,
} from '@crawlmouse/types/v2';
import { letterFor, nextBandFloor } from './letters';
import { listOf, percent, templateNoun } from './format';
import { capitalise, count, numberWord, plural } from './words';

type Crawler = Pick<
  CrawlerResult,
  'ua' | 'verdict' | 'cause' | 'evidence_class' | 'scored' | 'group'
>;

export const isAi = (c: Pick<CrawlerResult, 'group'>) => c.group !== 'search_engine';
export const isAllowed = (v: Verdict) => v === 'allowed' || v === 'allowed_thin';
export const isBlocked = (v: Verdict) => v === 'disallowed_by_robots' || v === 'blocked_by_ua_rule';
export const isChallenged = (v: Verdict) => v === 'challenged_ua' || v === 'refused_unverified';

/** What happened to a crawler that did not get in, singular and plural. */
function keptOut(verdict: Verdict, cause: AccessCause | null): [string, string] {
  switch (verdict) {
    case 'disallowed_by_robots':
      return ['is blocked by robots.txt', 'are blocked by robots.txt'];
    case 'blocked_by_ua_rule':
      return cause === 'cloudflare_1020'
        ? ['is blocked by a firewall rule', 'are blocked by a firewall rule']
        : ['is blocked by a rule', 'are blocked by a rule'];
    case 'challenged_ua':
      return ['gets a challenge page', 'get a challenge page'];
    case 'refused_unverified':
      return ['is admitted only from verified IPs', 'are admitted only from verified IPs'];
    case 'rate_limited':
      return ['is rate limited', 'are rate limited'];
    case 'payment_required':
      return ['is asked to pay (402)', 'are asked to pay (402)'];
    case 'edge_blocks_automation':
      return ['is refused at the edge', 'are refused at the edge'];
    case 'redirected_away':
      return ['is sent to another host', 'are sent to another host'];
    case 'not_measured':
      return ['could not be measured', 'could not be measured'];
    case 'allowed':
    case 'allowed_thin':
      throw new Error(`${verdict} is not kept out`);
  }
}

/**
 * "GPTBot is blocked by a firewall rule; PerplexityBot gets a challenge page": one clause per way
 * crawlers were kept out, in the order the crawlers are listed, crawlers sharing a way grouped.
 * A verdict resting on the site's own logs says so.
 */
export function keptOutClauses(crawlers: readonly Crawler[]): string[] {
  const groups = new Map<string, Crawler[]>();
  for (const c of crawlers.filter((x) => !isAllowed(x.verdict))) {
    const key = `${c.verdict}|${c.cause}|${c.evidence_class === 'observed'}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  // The most severe first: the contract lists verdicts from allowed to unmeasured.
  const order = (g: Crawler[]) => VerdictSchema.options.indexOf(g[0]!.verdict);
  return [...groups.values()]
    .sort((a, b) => order(a) - order(b))
    .map((g) => {
      const [one, many] = keptOut(g[0]!.verdict, g[0]!.cause);
      const seen = g[0]!.evidence_class === 'observed' ? ', in the site’s own logs' : '';
      return `${listOf(g.map((c) => c.ua))} ${g.length === 1 ? one : many}${seen}`;
    });
}

/** Templates every non-rendering crawler gets in to, but reads thin: the client-rendered ones. */
export function thinTemplates(check: Check): string[] {
  const keys = new Set<string>();
  for (const c of check.crawlers.filter(isAi)) {
    for (const t of c.by_template) if (t.verdict === 'allowed_thin') keys.add(t.template_key);
  }
  return (
    check.coverage?.templates.filter((t) => keys.has(t.template_key)).map((t) => t.template_key) ??
    []
  );
}

const labelOf = (check: Check, key: string) =>
  check.coverage!.templates.find((t) => t.template_key === key)!.label;

/** "Product pages are empty without JavaScript." for each thin template; empty when none is. */
export function thinSentence(check: Check): string | null {
  const thin = thinTemplates(check);
  if (!thin.length) return null;
  const names = thin.map((k) => templateNoun(labelOf(check, k)).pages);
  return `${capitalise(listOf(names))} ${thin.length === 1 && !names[0]!.endsWith('s') ? 'is' : 'are'} empty without JavaScript.`;
}

// ─── Grades ───────────────────────────────────────────────────────────────────────────────────

/**
 * The fewest fixes, largest Technical SEO effect first, whose estimated points take the score to
 * the next letter band. Null at the top band, or when all the fixes together do not reach it.
 */
export function fixesToNextBand(score: number, letter: string, fixes: readonly Fix[]) {
  const target = nextBandFloor(letter);
  if (!target) return null;
  const bySeo = [...fixes]
    .filter((f) => f.effect.technical_seo > 0)
    .sort(
      (a, b) => b.effect.technical_seo - a.effect.technical_seo || (a.rank ?? 0) - (b.rank ?? 0),
    );
  let points = 0;
  for (let i = 0; i < bySeo.length; i++) {
    points += bySeo[i]!.effect.technical_seo;
    if (score + points >= target.score) {
      return { fixes: bySeo.slice(0, i + 1), letter: letterFor(score + points) };
    }
  }
  return null;
}

/** "Two fixes take it to A-; one of them is open now." */
export function nextBandSentence(
  score: number,
  letter: string,
  fixes: readonly Fix[],
  isOpen: (f: Fix) => boolean,
): string | null {
  const reach = fixesToNextBand(score, letter, fixes);
  if (!reach) return null;
  const n = reach.fixes.length;
  const open = reach.fixes.filter(isOpen).length;
  const head = `${capitalise(numberWord(n))} ${plural(n, 'fix takes', 'fixes take')} it to ${reach.letter}`;
  if (n === 1) return `${head}; ${open ? 'it is open now' : 'it is on Pro'}.`;
  if (open === 0) return `${head}; they are on Pro.`;
  if (open === n) return `${head}; ${n === 2 ? 'both are' : 'all are'} open now.`;
  return `${head}; ${numberWord(open)} of them ${open === 1 ? 'is' : 'are'} open now.`;
}

/** Locked Home stage: "7 orphan pages. Three fixes take it to A-." */
export function seoShortSummary(check: Check, fixes: readonly Fix[], isOpen: (f: Fix) => boolean) {
  const t = check.technical_seo!;
  const orphans = check.structure!.orphan_pages;
  const lead = orphans
    ? `${count(orphans)} orphan ${plural(orphans, 'page', 'pages')}.`
    : 'No orphan pages.';
  const next =
    t.score !== null && t.grade ? nextBandSentence(t.score, t.grade, fixes, isOpen) : null;
  return next ? `${lead} ${next.replace(/;.*$/, '.')}` : lead;
}

/** The structure word for the site-structure score. */
export function structureWord(score: number): string {
  if (score >= 70) return 'Sound structure';
  if (score >= 50) return 'Uneven structure';
  return 'Weak structure';
}

/** Locked Result: "Sound structure; seven pages nobody links to. Three fixes take it to A-; …" */
export function seoSummary(check: Check, fixes: readonly Fix[], isOpen: (f: Fix) => boolean) {
  const t = check.technical_seo!;
  const orphans = check.structure!.orphan_pages;
  const linked = orphans
    ? `${numberWord(orphans)} ${plural(orphans, 'page nobody links to', 'pages nobody links to')}`
    : 'every page is linked';
  const lead = `${structureWord(t.site_structure_score ?? 0)}; ${linked}.`;
  const next =
    t.score !== null && t.grade ? nextBandSentence(t.score, t.grade, fixes, isOpen) : null;
  if (next) return `${lead} ${next}`;
  return fixes.length ? lead : `${lead} Nothing in this audit lowers it.`;
}

/** The scored crawlers (FACTS I6): who was kept out, and what the rest read. */
export function aiSummary(check: Check): string {
  const scored = check.crawlers.filter((c) => c.scored);
  const out = keptOutClauses(scored);
  const thin = thinTemplates(check);
  const rest = scored.filter((c) => isAllowed(c.verdict));
  if (!out.length && !thin.length) {
    const share = Math.min(...rest.map((c) => c.text_share ?? 0));
    return `All ${numberWord(scored.length)} scored crawlers get in and read ${percent(share)}% of the text or more.`;
  }
  const thinPart = thin.length
    ? `${listOf(thin.map((k) => templateNoun(labelOf(check, k)).pages))} are empty to ${out.length ? `the other ${numberWord(rest.length)}` : `all ${numberWord(rest.length)}`}`
    : null;
  return `${capitalise([out.join('; '), thinPart].filter(Boolean).join('; '))}.`;
}

/** Locked Home stage: the kept-out crawlers, then what the thin templates do. */
export function aiShortSummary(check: Check): string {
  const out = keptOutClauses(check.crawlers.filter((c) => c.scored));
  const thin = thinSentence(check);
  return [out.length ? `${capitalise(out.join('; '))}.` : null, thin].filter(Boolean).join(' ');
}

/** The withheld AI readability grade, said plainly (FACTS I4). */
export function aiWithheldSummary(check: Check, measured: number): string {
  const ai = check.ai_readability!;
  if (!ai.withheld) throw new Error('Not withheld');
  const scored = check.crawlers.filter((c) => c.scored).length;
  const edge = check.crawlers.some((c) => c.verdict === 'edge_blocks_automation');
  const why = edge
    ? `The site’s edge refused our requests whoever we said we were, so only ${numberWord(measured)} of the ${numberWord(scored)} scored crawlers could be measured.`
    : `Only ${numberWord(measured)} of the ${numberWord(scored)} scored crawlers could be measured.`;
  return `${why} Access is somewhere between ${ai.access_range.min} and ${ai.access_range.max} of 40.`;
}
