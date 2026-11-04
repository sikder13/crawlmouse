/**
 * Each fix's effect on the two grades, by counterfactual recompute: apply what fixing it means to the
 * grade inputs, recompute, take the difference. Never typed.
 *
 * Order and sum. Fixes whose AI effect applied alone can be stated rank first, by that effect
 * (Technical SEO plus AI readability, larger first); then those whose AI effect waits on a reason;
 * ties by fingerprint. In that order each fix's effect is the grade with it and every
 * fix ranked above it applied, less the grade without it:
 *
 *   effect(i) = grade(fixes 1..i) − grade(fixes 1..i−1)
 *
 * so the effects add up to the projected grade less the current one, before rounding to DECIMALS.
 *
 * Technical SEO is 0 while the grade is refused: as checked, or before or after the fix (effectOf). AI readability is
 * the change in the component the fix moves: Access for an edge-rule fix, Quotable for a content fix,
 * none for a structure fix. When that component has no score before or after, or an edge fix's crawler
 * has too few pages for a share, the AI effect is null and waits on the reason. A content fix on a check
 * Quotable does not count (CONTENT_CHECKS `scored`) moves no score: its AI effect is null and waits on
 * check_not_scored, and the overview leaves it out. A robots.txt disallow
 * is the site's stated intent: it opens no fix, so it has no counterfactual here.
 */
import type { Effect, LinkEdge, WithheldReason } from '@crawlmouse/types/v2';
import type { AccessDetection } from '../access/types.js';
import type { ContentDetection } from '../content/aggregate.js';
import { CONTENT_CHECKS } from '../content/checks.js';
import { subjectOfKey } from '../detectors/fingerprint.js';
import type { Detection } from '../detectors/types.js';
import { accessScore, crawlerShare, type CrawlerTally } from './access.js';
import type { AiInputs } from './index.js';
import { round, type Measure } from './numbers.js';
import { quotableScore } from './quotable.js';
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

/** What fixing `f` means, applied to the grade inputs. */
export function applyFix(inputs: Inputs, f: FixRecord): Inputs {
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
    // a check Quotable does not count moves nothing, whatever the inputs carry (`counts`)
    if (!counts(f) || t === undefined) return inputs;
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
  access: ReturnType<typeof accessScore>;
  quotable: Measure;
}

function scoresOf(i: Inputs): Scores {
  const { refusal, formula } = seoParts(i.seo);
  return {
    seo: refusal.refused ? null : formula,
    access: accessScore(i.ai.crawlers),
    quotable: quotableScore(i.ai.quotable),
  };
}

/** A fix that can move a grade: any but a content fix on a check Quotable does not count. */
const counts = (f: FixRecord) => f.family !== 'content' || CONTENT_CHECKS[f.record.check].scored;

/** The AI component each family of fix moves; a structure fix moves none. */
const MOVES = { access: 'access', content: 'quotable', structure: null } as const;

/**
 * The AI readability change from `a` to `b` caused by `fixes`, or the reasons it cannot be given: the
 * component a fix moves has no score before or after, or an edge fix's crawler has too few pages to
 * have a share of its own.
 */
function aiChange(
  a: Scores,
  b: Scores,
  fixes: readonly FixRecord[],
  before: Inputs,
): { points: number } | { waits: WithheldReason[] } {
  const waits = new Set<WithheldReason>();
  let points = 0;
  // A fix on a check Quotable does not count moves no score: it waits on that reason alone.
  if (!fixes.every(counts)) return { waits: ['check_not_scored'] };
  const moved = new Set(fixes.map((f) => MOVES[f.family]));
  if (moved.has('access')) {
    if (a.access.score === null || b.access.score === null)
      waits.add((a.access.reason ?? b.access.reason)!);
    const unmeasured = fixes.some(
      (f) =>
        f.family === 'access' &&
        before.ai.crawlers.some(
          (c) => c.ua === f.record.crawler && crawlerShare(c).standing !== 'measured',
        ),
    );
    if (unmeasured) waits.add('crawler_too_few_pages');
    if (waits.size === 0) points += b.access.score! - a.access.score!;
  }
  if (moved.has('quotable')) {
    if (a.quotable.score === null || b.quotable.score === null) waits.add('quotable_unmeasured');
    else points += b.quotable.score - a.quotable.score;
  }
  return waits.size ? { waits: [...waits] } : { points };
}

/**
 * The effect of `fixes` from inputs `before` (scores `a`) to scores `b`, in a chain that began at
 * scores `start`. Technical SEO is 0 when the grade is refused at the start of the chain, before this
 * fix or after it: there is no score to move, and the contract's Effect has no way to say "not
 * estimated" for Technical SEO yet (reported for CC-11). Zeroing from the start keeps the effects
 * adding up to the overview when a fix part-way down the chain lifts the grade out of refusal.
 */
function effectOf(
  a: Scores,
  b: Scores,
  fixes: readonly FixRecord[],
  before: Inputs,
  start: Scores,
): Effect {
  const ai = aiChange(a, b, fixes, before);
  const refused = start.seo === null || a.seo === null || b.seo === null;
  return {
    technical_seo: refused ? 0 : round(b.seo! - a.seo!),
    ai_readability: 'points' in ai ? round(ai.points) : null,
    ai_readability_pending_on: 'waits' in ai ? ai.waits : [],
    estimate: true,
  };
}

const fingerprintOf = (f: FixRecord) => f.record.fingerprint;

export interface Effects {
  /** Each fix's effect and rank, by fingerprint. */
  byFix: Map<string, { effect: Effect; rank: number }>;
  /** The projected grades less the current ones, with every fix applied. */
  overview: Effect;
}

export function effectsOf(inputs: Inputs, fixes: readonly FixRecord[]): Effects {
  const base = scoresOf(inputs);
  const alone = fixes.map((f) => {
    const after = scoresOf(applyFix(inputs, f));
    const e = effectOf(base, after, [f], inputs, base);
    // stated: the AI effect is not waiting on a reason. A refused Technical SEO grade does not enter
    // it: no fix can refuse a grade, so on a refused grade every fix's Technical SEO is unknown alike
    const stated = e.ai_readability !== null;
    return { f, stated, size: e.technical_seo + (e.ai_readability ?? 0) };
  });
  alone.sort(
    (x, y) =>
      Number(y.stated) - Number(x.stated) ||
      y.size - x.size ||
      (fingerprintOf(x.f) < fingerprintOf(y.f) ? -1 : 1),
  );
  const byFix = new Map<string, { effect: Effect; rank: number }>();
  let state = inputs;
  let before = base;
  alone.forEach(({ f }, i) => {
    const prior = state;
    state = applyFix(state, f);
    const after = scoresOf(state);
    byFix.set(fingerprintOf(f), { effect: effectOf(before, after, [f], prior, base), rank: i + 1 });
    before = after;
  });
  // The projection leaves out fixes that move no score, so the overview waits on no reason of theirs.
  return { byFix, overview: effectOf(base, before, fixes.filter(counts), inputs, base) };
}
