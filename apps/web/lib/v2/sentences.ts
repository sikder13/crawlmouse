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
  type WithheldReason,
} from '@crawlmouse/types/v2';
import { AI_WAITING } from './view/effect-headline';
import { sectionMeasured } from './view/section-measured';
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

/**
 * `edge_blocks_automation` in words: the access pill's, so a result names that one condition one
 * way. It says what our test saw: the request refused was our own control (F-145).
 */
export const EDGE_PILL = 'refused or challenged our tests';
export const EDGE_SENTENCE =
  'The site’s edge refused or challenged our browser-identity request from Crawlmouse’s address';
/**
 * What an edge that refuses automation shows, and what follows from it. The request it refused was
 * our browser-identity control, from our own address (F-145).
 */
export const EDGE_METHOD = `${EDGE_SENTENCE}, so no crawler request was measured where it did.`;

/** What a served crawler request proves: our request carrying its user agent was served (F-139). */
export const servedAll = (n: number, kind: 'AI' | 'scored') =>
  n === 1
    ? `The request with the one ${kind === 'AI' ? 'AI' : 'scored'} crawler’s user agent was served`
    : `Requests with all ${numberWord(n)} ${kind} crawlers’ user agents were served`;

export const servedOthers = (n: number) =>
  n === 1
    ? 'The request with the other AI crawler’s user agent was served'
    : `Requests with the other ${numberWord(n)} AI crawlers’ user agents were served`;

/** The crawlers our own request was served as: a verdict from robots.txt alone sent no request. */
const servedRows = (among: readonly CrawlerResult[]) =>
  among.filter((c) => isAllowed(c.verdict) && c.evidence_class !== 'declared');

/** A served crawler's row was stored before `pages_served` existed, so its count is not known. */
export const servedCountMissing = (check: Pick<Check, 'crawlers'>): boolean =>
  servedRows(check.crawlers.filter(isAi)).some((c) => c.pages_served === undefined);

/**
 * How many sampled pages our requests were served on, when that is less than the sample: a crawler
 * can read as served from one page in 25 (V2R question 010). A row stored before `pages_served`
 * existed claims what its verdict proves: served on at least half of the pages that answered.
 * `pages_measured` cannot say more, because it also counts refused and robots-disallowed pages. Empty
 * when each was served on the whole sample. `among` is the crawlers the sentence names. `short` drops
 * "the" and "sampled", for the pill, which does not use the wording for an older row.
 */
export function servedExtent(
  check: Pick<Check, 'crawlers' | 'coverage'>,
  short = false,
  among: readonly CrawlerResult[] = check.crawlers.filter(isAi),
): string {
  const sampled = check.coverage?.pages_sampled ?? 0;
  const rows = servedRows(among);
  if (!rows.length) return '';
  if (rows.some((c) => c.pages_served === undefined)) {
    return ', on at least half of the pages that answered';
  }
  const read = rows.map((c) => Math.min(c.pages_served!, sampled));
  if (read.every((n) => n >= sampled)) return '';
  const low = Math.min(...read);
  const high = Math.max(...read);
  const range = low === high ? count(low) : `${count(low)} to ${count(high)}`;
  const noun = plural(sampled, 'page', 'pages');
  return short
    ? `, on ${range} of ${count(sampled)} ${noun}`
    : `, on ${range} of the ${count(sampled)} sampled ${noun}`;
}

export const meetsEdge = (check: Pick<Check, 'crawlers'>) =>
  check.crawlers.some((c) => c.verdict === 'edge_blocks_automation');

/** What happened to a crawler that did not get in, singular and plural. */
const OUR_REQUEST = / when we sent (?:its user agent|their user agents)/;

function keptOut(verdict: Verdict, cause: AccessCause | null): [string, string] {
  switch (verdict) {
    case 'disallowed_by_robots':
      return ['is blocked by robots.txt', 'are blocked by robots.txt'];
    case 'blocked_by_ua_rule':
      return cause === 'cloudflare_1020'
        ? [
            'was refused by a firewall rule when we sent its user agent',
            'were refused by a firewall rule when we sent their user agents',
          ]
        : [
            'was refused when we sent its user agent, while another crawler name was served',
            'were refused when we sent their user agents, while another crawler name was served',
          ];
    case 'challenged_ua':
      return [
        'was challenged when we sent its user agent',
        'were challenged when we sent their user agents',
      ];
    case 'refused_unverified':
      return [
        'was refused on pages where no other crawler name was served; this may be IP verification',
        'were refused on pages where no other crawler name was served; this may be IP verification',
      ];
    case 'rate_limited':
      return [
        'was rate limited when we sent its user agent',
        'were rate limited when we sent their user agents',
      ];
    case 'payment_required':
      return [
        'was asked to pay (402) when we sent its user agent',
        'were asked to pay (402) when we sent their user agents',
      ];
    case 'edge_blocks_automation':
      return [
        'could not be tested: the site’s edge refused or challenged our control request',
        'could not be tested: the site’s edge refused or challenged our control request',
      ];
    case 'redirected_away':
      return [
        'was sent to another host when we sent its user agent',
        'were sent to another host when we sent their user agents',
      ];
    case 'not_measured':
      return ['could not be measured', 'could not be measured'];
    case 'allowed':
    case 'allowed_thin':
      throw new Error(`${verdict} is not kept out`);
  }
}

/**
 * "GPTBot was refused by a firewall rule when we sent its user agent; PerplexityBot was challenged when we sent its user agent": one clause per way
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
      const observed = g[0]!.evidence_class === 'observed';
      const clause = g.length === 1 ? one : many;
      // An observed row is the site's log of the real crawler: we sent nothing in its name.
      const said = observed ? clause.replace(OUR_REQUEST, '') : clause;
      return `${listOf(g.map((c) => c.ua))} ${said}${observed ? ', in the site’s own logs' : ''}`;
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
 * The client-rendered templates, as the AI crawlers' verdicts show them (`thinTemplates` over every
 * AI crawler), or null when some template was read by no AI crawler (all kept out of it, or the
 * edge refused our test requests): the verdicts then cannot say whether that template arrives empty,
 * so they are not used to say which do. Every screen that names those templates reads them here,
 * so a door and its segment cannot differ.
 */
export function clientRenderedTemplates(check: Check): string[] | null {
  const ai = check.crawlers.filter(isAi);
  const templates = check.coverage?.templates ?? [];
  const everyRead = templates.every((t) =>
    ai.some((c) => {
      const v = verdictOn(c, t.template_key);
      return v !== undefined && isAllowed(v);
    }),
  );
  return templates.length && everyRead ? thinTemplates(check, ai) : null;
}

/**
 * Whether a template's page noun is singular. The nouns are plural ("product pages") except the
 * homepage's, "the homepage": one page, which its article marks. sentences.test.ts checks every
 * noun in format.ts against that.
 */
export const isSingularNoun = (pages: string) => pages.startsWith('the ');

/** The verb for a list of page nouns: singular for one singular noun, otherwise plural. */
export const verbFor = (names: readonly string[], one: string, many: string) =>
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
  // an effect not estimated (the grade is refused) counts for nothing
  const seo = (f: Fix) => f.effect.technical_seo ?? 0;
  const bySeo = [...fixes]
    .filter((f) => seo(f) > 0)
    .sort((a, b) => seo(b) - seo(a) || (a.rank ?? 0) - (b.rank ?? 0));
  let points = 0;
  for (let i = 0; i < bySeo.length; i++) {
    points += seo(bySeo[i]!);
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

/** What a Technical SEO summary says of a check that read no internal link. */
const NO_LINK_READ = 'No internal link was read, so the structure was not measured.';

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
  if (!sectionMeasured(check, 'structure')) return NO_LINK_READ;
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
  // With no fix found, say that; the score's components may still sit below their best.
  return fixes.length ? lead : `${lead} No fix in this audit raises it.`;
}

/**
 * "All four scored crawlers are served and read 98% of the text or more": the share only when every one
 * was measured, and a plain statement when none was tested.
 */
function allInSentence(scored: readonly CrawlerResult[], extent: string): string {
  if (!scored.length) return 'No scored AI crawler was tested.';
  const shares = scored.map((c) => c.text_share);
  const one = scored.length === 1;
  const all = `${servedAll(scored.length, 'scored')}${extent}`;
  if (shares.some((x) => x === null)) return `${all}.`;
  const share = percent(Math.min(...(shares as number[])));
  return `${all}, with ${share}% of the text or more.`;
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
  if (!out.length && !byReaders.size) {
    return allInSentence(scored, servedExtent(check, false, scored));
  }
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
  if (!out.length && !thin) {
    const scored = scoredOf(check);
    return allInSentence(scored, servedExtent(check, false, scored));
  }
  return [out.length ? `${capitalise(out.join('; '))}.` : null, thin].filter(Boolean).join(' ');
}

/** FACTS I4: the scored crawlers a grade needs measured. The engine's MIN_MEASURED_CRAWLERS. */
export const I4_MEASURED_CRAWLERS = 2;

/** What each unmeasured part of the AI grade is called, in a sentence about one audit. */
const MISSING_PART: Partial<Record<WithheldReason, string>> = {
  readable_unmeasured: 'the JavaScript comparison',
  quotable_unmeasured: 'a content score',
  signals_unmeasured: 'the schema.org and Content Signals checks',
};

const orList = (xs: readonly string[]) =>
  xs.length < 2
    ? (xs[0] ?? '')
    : `${xs.filter((_, i) => i < xs.length - 1).join(', ')} or ${xs.at(-1)}`;

/**
 * The withheld AI readability grade, said plainly (FACTS I4). `measured` is the contract's count
 * (`scoredCrawlersMeasured`: a scored crawler with a verdict). The engine withholds by a count of
 * its own (a crawler with pages enough that were served or refused), so the two can part:
 * a site that challenges each crawler has four measured by the contract and none by the engine.
 * What is said therefore follows the reasons the grade names (`withheld_reasons`), of which a
 * withheld grade names at least one (CheckSchema refuses one that names none, and so does this):
 *   - where the grade names the count and the contract's count is itself under I4's two, the count
 *     of crawlers, with the edge named when a crawler met it;
 *   - where the grade names the count and the contract's count is not under two, the reason's own
 *     sentence (`AI_WAITING`), after the edge's when a crawler met it;
 *   - for a grade that does not name the count, its first reason's sentence.
 */
export function aiWithheldSummary(check: Check, measured: number): string {
  const ai = check.ai_readability!;
  if (!ai.withheld) throw new Error('Not withheld');
  if (ai.withheld_reasons.length === 0) throw new Error('A withheld grade names why');
  const scored = check.crawlers.filter((c) => c.scored).length;
  const reasons = ai.withheld_reasons;
  const byCount = reasons.includes('too_few_crawlers_measured');
  const edge = meetsEdge(check);
  const few = `${measured === 0 ? 'none' : `only ${numberWord(measured)}`} of the ${numberWord(scored)} scored crawlers could be measured`;
  const counted = edge ? `${EDGE_SENTENCE}, so ${few}.` : `${capitalise(few)}.`;
  // A site's own robots.txt withholds the grade by choice: measuring more would not give it one.
  const missing = reasons.includes('blocked_by_choice')
    ? []
    : reasons.flatMap((r) => MISSING_PART[r] ?? []);
  const why = !byCount
    ? missing.length && MISSING_PART[reasons[0]!]
      ? ''
      : `${AI_WAITING[reasons[0]!]}.`
    : measured < I4_MEASURED_CRAWLERS
      ? counted
      : `${edge ? `${EDGE_SENTENCE}. ` : ''}${AI_WAITING.too_few_crawlers_measured}.`;
  // Said of this audit and built from what it holds, so a minted report's copy stays true (F-012).
  const unmeasured = missing.length
    ? `This audit did not measure ${orList(missing)}, which the AI readability grade needs.`
    : '';
  const { access: accessPart, quotable, signals } = ai.components;
  // The grade stores how many crawlers Access rests on only when it is one. Otherwise it is at least
  // I4's two, and a stored check cannot say more: a crawler with a verdict may not have counted.
  const from = ai.scored_from_fewer_crawlers;
  const accessFrom =
    from === null ? `at least ${numberWord(I4_MEASURED_CRAWLERS)}` : numberWord(from);
  const tested = [
    accessPart.score === null
      ? null
      : `crawler access for ${accessFrom} of the ${numberWord(scored)} scored crawlers`,
    quotable.score === null ? null : 'content',
    signals.score === null ? null : 'AI signals',
  ].filter((x): x is string => x !== null);
  const testedSentence = missing.length && tested.length ? `It tested ${listOf(tested)}.` : '';
  const range = ai.access_range;
  const access = range ? `Access is somewhere between ${range.min} and ${range.max} of 40.` : '';
  return [why, unmeasured, testedSentence, access].filter(Boolean).join(' ');
}
