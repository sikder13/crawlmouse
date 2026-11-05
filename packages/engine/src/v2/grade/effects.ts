/**
 * Each fix's effect on the two grades, by counterfactual recompute: apply what fixing it means to the
 * grade inputs, recompute, take the difference. Never typed.
 *
 * Order and sum. Fixes whose AI effect applied alone can be stated rank first, by that effect
 * (Technical SEO plus AI readability, larger first; an effect not estimated counts 0); then those whose
 * AI effect waits on a reason; ties by fingerprint. In that order each fix's effect is the grade with
 * it and every fix ranked above it applied, less the grade without it:
 *
 *   effect(i) = grade(fixes 1..i) − grade(fixes 1..i−1)
 *
 * so the effects add up to the projected grade less the current one, both as given (each to DECIMALS
 * places).
 *
 * Technical SEO is null, waiting on `grade_refused`, while the grade is refused: as checked, or before
 * or after the fix (effectOf). AI readability is the change in the grade's total, and is null while
 * the grade is withheld as checked, before or after the fix: it then waits on the grade's withheld
 * reasons (owner ruling, 2026-11-05). It also waits when the fix cannot move a score: a content fix on
 * a check Quotable does not count (CONTENT_CHECKS `scored`) waits on `check_not_scored`, and the
 * overview leaves it out; an edge fix whose crawler has too few pages for a share waits on
 * `crawler_too_few_pages`. A robots.txt disallow is the site's stated intent: it opens no fix, so it
 * has no counterfactual here.
 *
 * Absorbed. A fix that alone would raise a grade (Technical SEO plus AI readability above 0) and whose
 * effect in the order is 0 or less was absorbed by a fix ranked above it. That fix is looked for among
 * the higher-ranked fixes that name a page, crawler or template the fix names (`touches`), in rank
 * order: the first one by whose application the fix's effect is 0 or less. None found leaves
 * `absorbed_by` empty.
 */
import type {
  AiReadability,
  ContentCheck,
  Effect,
  LinkEdge,
  WithheldReason,
} from '@crawlmouse/types/v2';
import type { AccessDetection } from '../access/types.js';
import type { ContentDetection } from '../content/aggregate.js';
import { CONTENT_CHECKS } from '../content/checks.js';
import { subjectOfKey } from '../detectors/fingerprint.js';
import type { Detection } from '../detectors/types.js';
import { accessScore, crawlerShare, type CrawlerTally } from './access.js';
import { aiReadability } from './ai-readability.js';
import type { AiInputs } from './index.js';
import { round } from './numbers.js';
import { quotableScore } from './quotable.js';
import { readableScore } from './readable.js';
import { signalsScore } from './signals.js';
import { MAX_HEALTHY_DEPTH } from '../../constants.js';
import { isGraded, seoParts, type TechnicalSeoInput } from './technical-seo.js';

export type FixRecord =
  | { family: 'structure'; record: Detection }
  | { family: 'access'; record: AccessDetection }
  | { family: 'content'; record: ContentDetection };

interface Inputs {
  seo: TechnicalSeoInput;
  ai: AiInputs;
}

/** The counterfactual's link from `from` to `to`, recorded so anchor diversity leaves it out. */
function addEdge(seo: TechnicalSeoInput, from: string, to: string): TechnicalSeoInput {
  if (from === to || seo.edges.some((e) => e.from_url === from && e.to_url === to)) return seo;
  const edge: LinkEdge = {
    check_id: seo.pages[0]?.check_id ?? '',
    from_url: from,
    to_url: to,
    anchor_text: '',
    is_generic_anchor: false,
    js_only: false,
  };
  return {
    ...seo,
    edges: [...seo.edges, edge],
    added_links: [...seo.added_links, `${from}\u0000${to}`],
  };
}

/**
 * The page a deep page is linked from: one MAX_HEALTHY_DEPTH − 1 clicks from the homepage (the lowest
 * URL), so the page lands within MAX_HEALTHY_DEPTH clicks with the smallest change to the link graph;
 * the shallowest page there is when none is that deep.
 */
function shallowParent(seo: TechnicalSeoInput): string {
  const depth = new Map([[seo.homepage_url, 0]]);
  const out = new Map<string, string[]>();
  for (const e of seo.edges) out.set(e.from_url, [...(out.get(e.from_url) ?? []), e.to_url]);
  let frontier = [seo.homepage_url];
  for (let d = 1; frontier.length > 0 && d < MAX_HEALTHY_DEPTH; d++) {
    const next: string[] = [];
    for (const u of frontier)
      for (const v of out.get(u) ?? [])
        if (!depth.has(v)) {
          depth.set(v, d);
          next.push(v);
        }
    frontier = next;
  }
  const graded = new Set(seo.pages.filter(isGraded).map((p) => p.url));
  const best = [...depth].filter(([u]) => graded.has(u) || u === seo.homepage_url);
  const deepest = Math.max(...best.map(([, d]) => d));
  return best
    .filter(([, d]) => d === deepest)
    .map(([u]) => u)
    .sort()[0]!;
}

const cleared = (seo: TechnicalSeoInput, fingerprint: string): TechnicalSeoInput => ({
  ...seo,
  detections: seo.detections.map((d) =>
    d.fingerprint === fingerprint ? { ...d, state: 'not_detected' as const } : d,
  ),
});

function servedAll(c: CrawlerTally): CrawlerTally {
  const blocked = c.counts.blocked_by_ua_rule ?? 0;
  return {
    ...c,
    counts: { ...c.counts, blocked_by_ua_rule: 0, allowed: (c.counts.allowed ?? 0) + blocked },
  };
}

/** The content checks Quotable counts (CONTENT_CHECKS `scored`): none until CC-18 (labels.test.ts). */
export const COUNTED: ReadonlySet<ContentCheck> = new Set(
  (Object.keys(CONTENT_CHECKS) as ContentCheck[]).filter((c) => CONTENT_CHECKS[c].scored),
);

/**
 * What fixing `f` means, applied to the grade inputs. `counted` is the checks Quotable counts; the
 * tests pass their own to reach a content fix's counterfactual while no check counts.
 */
export function applyFix(
  inputs: Inputs,
  f: FixRecord,
  counted: ReadonlySet<ContentCheck> = COUNTED,
): Inputs {
  const { seo, ai } = inputs;
  if (f.family === 'access') {
    // A robots.txt disallow is respected intent and opens no fix (outcomes.ts), so only an edge rule
    // has a counterfactual: the crawler served where it was blocked.
    if (f.record.type !== 'edge_rule_blocks_crawler') {
      throw new Error(`effects: no counterfactual for ${f.record.type}`);
    }
    return {
      seo,
      ai: {
        ...ai,
        crawlers: ai.crawlers.map((c) => (c.ua === f.record.crawler ? servedAll(c) : c)),
      },
    };
  }
  if (f.family === 'content') {
    const t = ai.quotable.checks[f.record.check];
    // a check Quotable does not count moves nothing, whatever the inputs carry
    if (!counts(f, counted) || t === undefined) return inputs;
    const checks = {
      ...ai.quotable.checks,
      [f.record.check]: { ...t, passing: t.passing + f.record.extent.failing },
    };
    return { seo, ai: { ...ai, quotable: { checks } } };
  }
  const r = f.record;
  const url = subjectOfKey(r.key);
  switch (r.type) {
    case 'orphan_pages': {
      const parent = seo.pages.find((p) => p.url === url)?.suggested_parent_url ?? seo.homepage_url;
      return { seo: addEdge(seo, parent, url), ai };
    }
    case 'deep_pages':
      return { seo: addEdge(seo, shallowParent(seo), url), ai };
    case 'generic_anchor_text':
      return {
        seo: {
          ...seo,
          edges: seo.edges.map((e) =>
            e.from_url === url ? { ...e, is_generic_anchor: false } : e,
          ),
        },
        ai,
      };
    default:
      return { seo: cleared(seo, r.fingerprint), ai };
  }
}

interface Scores {
  /** The Technical SEO score; null when the grade is refused. */
  seo: number | null;
  ai: AiReadability;
}

function scoresOf(i: Inputs): Scores {
  const { refusal, formula } = seoParts(i.seo);
  return {
    seo: refusal.refused ? null : formula,
    ai: aiReadability({
      access: accessScore(i.ai.crawlers),
      readable: readableScore(i.ai.readable),
      quotable: quotableScore(i.ai.quotable),
      signals: signalsScore(i.ai.signals),
    }),
  };
}

/** A fix that can move a grade: any but a content fix on a check Quotable does not count. */
const counts = (f: FixRecord, counted: ReadonlySet<ContentCheck>) =>
  f.family !== 'content' || counted.has(f.record.check);

/**
 * The AI readability change from `a` to `b` caused by `fixes`, in a chain that began at `start`, or
 * the reasons it cannot be given: the fix cannot move a score, or the grade is withheld at the start,
 * before or after.
 */
function aiChange(
  a: Scores,
  b: Scores,
  fixes: readonly FixRecord[],
  before: Inputs,
  start: Scores,
  counted: ReadonlySet<ContentCheck>,
): { points: number } | { waits: WithheldReason[] } {
  const waits = new Set<WithheldReason>();
  if (!fixes.every((f) => counts(f, counted))) waits.add('check_not_scored');
  const unmeasured = fixes.some(
    (f) =>
      f.family === 'access' &&
      before.ai.crawlers.some(
        (c) => c.ua === f.record.crawler && crawlerShare(c).standing !== 'measured',
      ),
  );
  if (unmeasured) waits.add('crawler_too_few_pages');
  for (const s of [start, a, b]) for (const r of s.ai.withheld_reasons) waits.add(r);
  if (waits.size > 0 || a.ai.withheld || b.ai.withheld) return { waits: [...waits] };
  return { points: b.ai.total - a.ai.total };
}

/**
 * The effect of `fixes` from inputs `before` (scores `a`) to scores `b`, in a chain that began at
 * scores `start`. Technical SEO waits on `grade_refused` when the grade is refused at the start of the
 * chain, before this fix or after it: there is no score to move. Waiting from the start keeps the
 * effects adding up to the overview when a fix part-way down the chain lifts the grade out of refusal.
 */
function effectOf(
  a: Scores,
  b: Scores,
  fixes: readonly FixRecord[],
  before: Inputs,
  start: Scores,
  counted: ReadonlySet<ContentCheck>,
): Effect {
  const ai = aiChange(a, b, fixes, before, start, counted);
  const refused = start.seo === null || a.seo === null || b.seo === null;
  return {
    technical_seo: refused ? null : round(b.seo! - a.seo!),
    technical_seo_pending_on: refused ? ['grade_refused'] : [],
    ai_readability: 'points' in ai ? round(ai.points) : null,
    ai_readability_pending_on: 'waits' in ai ? ai.waits : [],
    absorbed_by: null,
    estimate: true,
  };
}

/** Both grades' points, an effect not estimated counting 0. */
const sizeOf = (e: Effect) => (e.technical_seo ?? 0) + (e.ai_readability ?? 0);

const fingerprintOf = (f: FixRecord) => f.record.fingerprint;

/** What a fix names: its pages, its crawler or its template. */
function names(f: FixRecord): Set<string> {
  if (f.family === 'access') return new Set([`crawler:${f.record.crawler}`]);
  if (f.family === 'content') return new Set([`template:${f.record.template_key}`]);
  return new Set([subjectOfKey(f.record.key), ...f.record.affected_urls]);
}

/** Two fixes name a page, crawler or template in common. */
function touches(f: FixRecord, g: FixRecord): boolean {
  const theirs = names(g);
  return [...names(f)].some((n) => theirs.has(n));
}

export interface Effects {
  /**
   * Each fix's effect and rank, by fingerprint, with the fingerprint of the higher-ranked fix that
   * absorbed it (the diff turns it into that fix's number, `Effect.absorbed_by`).
   */
  byFix: Map<string, { effect: Effect; rank: number; absorbed_by: string | null }>;
  /** The projected grades less the current ones, with every fix applied. */
  overview: Effect;
}

export function effectsOf(
  inputs: Inputs,
  fixes: readonly FixRecord[],
  counted: ReadonlySet<ContentCheck> = COUNTED,
): Effects {
  const base = scoresOf(inputs);
  const apply = (i: Inputs, f: FixRecord) => applyFix(i, f, counted);
  const effect = (a: Scores, b: Scores, fs: readonly FixRecord[], before: Inputs) =>
    effectOf(a, b, fs, before, base, counted);
  const alone = fixes.map((f) => {
    const after = scoresOf(apply(inputs, f));
    const e = effect(base, after, [f], inputs);
    // stated: the AI effect is not waiting on a reason. A refused Technical SEO grade does not enter
    // it: no fix can refuse a grade, so on a refused grade every fix's Technical SEO is unknown alike
    const stated = e.ai_readability !== null;
    return { f, stated, size: sizeOf(e) };
  });
  alone.sort(
    (x, y) =>
      Number(y.stated) - Number(x.stated) ||
      y.size - x.size ||
      (fingerprintOf(x.f) < fingerprintOf(y.f) ? -1 : 1),
  );
  // states[k] and scores[k]: the inputs and scores with the first k fixes applied
  const states: Inputs[] = [inputs];
  const scores: Scores[] = [base];
  const effects: Effect[] = [];
  alone.forEach(({ f }, i) => {
    states.push(apply(states[i]!, f));
    scores.push(scoresOf(states[i + 1]!));
    effects.push(effect(scores[i]!, scores[i + 1]!, [f], states[i]!));
  });
  const byFix: Effects['byFix'] = new Map();
  alone.forEach(({ f, size }, i) => {
    let absorbed_by: string | null = null;
    if (size > 0 && sizeOf(effects[i]!) <= 0) {
      for (let j = 0; j < i && absorbed_by === null; j++) {
        const g = alone[j]!.f;
        if (!touches(f, g)) continue;
        const after = scoresOf(apply(states[j + 1]!, f));
        const e = effect(scores[j + 1]!, after, [f], states[j + 1]!);
        if (sizeOf(e) <= 0) absorbed_by = fingerprintOf(g);
      }
    }
    byFix.set(fingerprintOf(f), { effect: effects[i]!, rank: i + 1, absorbed_by });
  });
  // The projection leaves out fixes that move no score, so the overview waits on no reason of theirs.
  return {
    byFix,
    overview: effect(
      base,
      scores.at(-1)!,
      fixes.filter((f) => counts(f, counted)),
      inputs,
    ),
  };
}
