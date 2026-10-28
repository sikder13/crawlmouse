/**
 * The grade cards' sentences, and the crawler clauses the Result doors reuse, built from the data
 * rather than written about it (OPERATING-RULES §10). The functions are pure. sentences.test.ts
 * tests the wording at the structure thresholds (70 and 50), at singular and plural forms, and at
 * the branches of the next-band sentence.
 *
 * Vocabulary (FACTS I2): "blocked" only for `disallowed_by_robots` and `blocked_by_ua_rule`
 * (sentences.test.ts sweeps the verdicts for it); a challenge is a challenge, and the real crawler
 * may pass it.
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
 * crawlers were kept out, in the contract's order of verdicts (`VerdictSchema`), crawlers sharing a
 * way grouped in the order they are listed.
 * A verdict resting on the site's own logs says so.
 */
export function keptOutClauses(crawlers: readonly Crawler[]): string[] {
  const groups = new Map<string, Crawler[]>();
  for (const c of crawlers.filter((x) => !isAllowed(x.verdict))) {
    const key = `${c.verdict}|${c.cause}|${c.evidence_class === 'observed'}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  // The contract's order, which is not a ranking of how bad each verdict is.
  const order = (g: Crawler[]) => VerdictSchema.options.indexOf(g[0]!.verdict);
  return [...groups.values()]
    .sort((a, b) => order(a) - order(b))
    .map((g) => {
      const [one, many] = keptOut(g[0]!.verdict, g[0]!.cause);
      const seen = g[0]!.evidence_class === 'observed' ? ', in the site’s own logs' : '';
      return `${listOf(g.map((c) => c.ua))} ${g.length === 1 ? one : many}${seen}`;
    });
}

type Reader = Pick<CrawlerResult, 'ua' | 'by_template'>;

const verdictOn = (c: Reader, key: string) =>
  c.by_template.find((t) => t.template_key === key)?.verdict;

/** For each template, in the coverage's order, which of `crawlers` read it thin; none listed is left out. */
function thinReaders(check: Check, crawlers: readonly Reader[]): [key: string, uas: string[]][] {
  return (check.coverage?.templates ?? [])
    .map((t): [string, string[]] => [
      t.template_key,
      crawlers.filter((c) => verdictOn(c, t.template_key) === 'allowed_thin').map((c) => c.ua),
    ])
    .filter(([, uas]) => uas.length > 0);
}

/**
 * The client-rendered templates, as `crawlers` saw them: read thin by at least one of them and in
 * full by none. One crawler reading a template in full is evidence its text is in the HTML.
 */
export function thinTemplates(check: Check, crawlers: readonly Reader[]): string[] {
  return thinReaders(check, crawlers)
    .map(([key]) => key)
    .filter((key) => !crawlers.some((c) => verdictOn(c, key) === 'allowed'));
}

/**
 * Whether a template's page noun is singular. The nouns are plural ("product pages") except the
 * homepage's, "the homepage": one page, which its article marks. sentences.test.ts checks every
 * noun in format.ts against that.
 */
export const isSingularNoun = (pages: string) => pages.startsWith('the ');

/** The verb for a list of page nouns: singular for one singular noun, otherwise plural. */
const verbFor = (names: readonly string[], one: string, many: string) =>
  names.length === 1 && isSingularNoun(names[0]!) ? one : many;

const labelOf = (check: Check, key: string) =>
  check.coverage!.templates.find((t) => t.template_key === key)!.label;
const pagesOf = (check: Check, key: string) => templateNoun(labelOf(check, key)).pages;

const scoredOf = (check: Check) => check.crawlers.filter((c) => c.scored);

/** "Product pages are empty without JavaScript.", from the scored crawlers; null when none reads a template thin. */
export function thinSentence(check: Check): string | null {
  const names = thinTemplates(check, scoredOf(check)).map((k) => pagesOf(check, k));
  if (!names.length) return null;
  return `${capitalise(listOf(names))} ${verbFor(names, 'is', 'are')} empty without JavaScript.`;
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
  // A refused grade has no structure score: then the sentence says only what was counted.
  const lead =
    t.site_structure_score === null
      ? `${capitalise(linked)}.`
      : `${structureWord(t.site_structure_score)}; ${linked}.`;
  const next =
    t.score !== null && t.grade ? nextBandSentence(t.score, t.grade, fixes, isOpen) : null;
  if (next) return `${lead} ${next}`;
  return fixes.length ? lead : `${lead} Nothing in this audit lowers it.`;
}

/** "All four scored crawlers get in and read 98% of the text or more." */
function allInSentence(scored: readonly CrawlerResult[]): string {
  const share = Math.min(...scored.map((c) => c.text_share ?? 0));
  return `All ${numberWord(scored.length)} scored crawlers get in and read ${percent(share)}% of the text or more.`;
}

/**
 * The scored crawlers (FACTS I6): who was kept out, then, template by template, which of those that
 * got in read it thin, named as "the other three" only when it is all of them.
 */
export function aiSummary(check: Check): string {
  const scored = scoredOf(check);
  const out = keptOutClauses(scored);
  const inside = scored.filter((c) => isAllowed(c.verdict));
  // Templates read thin by the same crawlers share a clause.
  const byReaders = new Map<string, { uas: string[]; names: string[] }>();
  for (const [key, uas] of thinReaders(check, inside)) {
    const entry = byReaders.get(uas.join('\n')) ?? { uas, names: [] };
    entry.names.push(pagesOf(check, key));
    byReaders.set(uas.join('\n'), entry);
  }
  if (!out.length && !byReaders.size) return allInSentence(scored);
  const thin = [...byReaders.values()].map(({ uas, names }) => {
    const who =
      uas.length < inside.length
        ? listOf(uas)
        : out.length
          ? `the other ${numberWord(inside.length)}`
          : `all ${numberWord(inside.length)}`;
    return `${listOf(names)} ${verbFor(names, 'is', 'are')} empty to ${who}`;
  });
  return `${capitalise([...out, ...thin].join('; '))}.`;
}

/**
 * Locked Home stage: the scored crawlers kept out, then the templates they read thin; when there is
 * neither, the sentence the AI card uses for a site every scored crawler reads.
 */
export function aiShortSummary(check: Check): string {
  const out = keptOutClauses(scoredOf(check));
  const thin = thinSentence(check);
  if (!out.length && !thin) return allInSentence(scoredOf(check));
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
