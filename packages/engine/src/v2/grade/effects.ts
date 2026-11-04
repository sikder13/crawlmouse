/**
 * Each fix's effect on the two grades, by counterfactual recompute: apply what fixing it means to the
 * grade inputs, recompute, take the difference. Never typed.
 *
 * Order and sum. Fixes are ranked by their effect applied alone (Technical SEO plus AI readability,
 * larger first; ties by fingerprint). In that order each fix's effect is the grade with it and every
 * fix ranked above it applied, less the grade without it:
 *
 *   effect(i) = grade(fixes 1..i) − grade(fixes 1..i−1)
 *
 * so the effects add up to the projected grade less the current one, before rounding to DECIMALS.
 *
 * Technical SEO is measured on its formula's value whether or not the grade is refused. AI readability
 * is the change in the component the fix moves: Access for an edge-rule fix, Quotable for a content
 * fix, none for a structure fix. When that component has no score before or after, the AI effect is
 * null and waits on the component's reason. A robots.txt disallow is the site's stated intent: it opens
 * no fix, so it has no counterfactual here.
 */
import type { Effect, LinkEdge, WithheldReason } from '@crawlmouse/types/v2';
import type { AccessDetection } from '../access/types.js';
import type { ContentDetection } from '../content/aggregate.js';
import { subjectOfKey } from '../detectors/fingerprint.js';
import type { Detection } from '../detectors/types.js';
import { accessScore, type CrawlerTally } from './access.js';
import type { AiInputs } from './index.js';
import { round, type Measure } from './numbers.js';
import { quotableScore } from './quotable.js';
import { seoFormula, type TechnicalSeoInput } from './technical-seo.js';

export type FixRecord =
  | { family: 'structure'; record: Detection }
  | { family: 'access'; record: AccessDetection }
  | { family: 'content'; record: ContentDetection };

interface Inputs {
  seo: TechnicalSeoInput;
  ai: AiInputs;
}

function addEdge(seo: TechnicalSeoInput, from: string, to: string): TechnicalSeoInput {
  if (from === to || seo.edges.some((e) => e.from_url === from && e.to_url === to)) return seo;
  const edge: LinkEdge = {
    check_id: seo.pages[0]?.check_id ?? '',
    from_url: from,
    to_url: to,
    anchor_text: to,
    is_generic_anchor: false,
    js_only: false,
  };
  return { ...seo, edges: [...seo.edges, edge] };
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
    const checks = {
      ...ai.quotable.checks,
      [f.record.check]: { ...t, passing: t.passing + f.record.extent.failing },
    };
    return { seo, ai: { ...ai, quotable: { ...ai.quotable, checks } } };
  }
  const r = f.record;
  const url = subjectOfKey(r.key);
  switch (r.type) {
    case 'orphan_pages': {
      const parent = seo.pages.find((p) => p.url === url)?.suggested_parent_url ?? seo.homepage_url;
      return { seo: addEdge(seo, parent, url), ai };
    }
    case 'deep_pages':
      return { seo: addEdge(seo, seo.homepage_url, url), ai };
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
  seo: number;
  access: ReturnType<typeof accessScore>;
  quotable: Measure;
}

const scoresOf = (i: Inputs): Scores => ({
  seo: seoFormula(i.seo),
  access: accessScore(i.ai.crawlers),
  quotable: quotableScore(i.ai.quotable),
});

const same = (x: Measure, y: Measure) =>
  x.score === y.score && x.range?.min === y.range?.min && x.range?.max === y.range?.max;

/** The AI readability change from `a` to `b`, or the reasons it cannot be given. */
function aiChange(a: Scores, b: Scores): { points: number } | { waits: WithheldReason[] } {
  const waits: WithheldReason[] = [];
  let points = 0;
  if (!same(a.access, b.access) || a.access.reason !== b.access.reason) {
    if (a.access.score === null || b.access.score === null)
      waits.push((a.access.reason ?? b.access.reason)!);
    else points += b.access.score - a.access.score;
  }
  if (!same(a.quotable, b.quotable)) {
    if (a.quotable.score === null || b.quotable.score === null) waits.push('quotable_unmeasured');
    else points += b.quotable.score - a.quotable.score;
  }
  return waits.length ? { waits } : { points };
}

function effectOf(a: Scores, b: Scores): Effect {
  const ai = aiChange(a, b);
  return {
    technical_seo: round(b.seo - a.seo),
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
    const e = effectOf(base, scoresOf(applyFix(inputs, f)));
    return { f, size: e.technical_seo + (e.ai_readability ?? 0) };
  });
  alone.sort((x, y) => y.size - x.size || (fingerprintOf(x.f) < fingerprintOf(y.f) ? -1 : 1));
  const byFix = new Map<string, { effect: Effect; rank: number }>();
  let state = inputs;
  let before = base;
  alone.forEach(({ f }, i) => {
    state = applyFix(state, f);
    const after = scoresOf(state);
    byFix.set(fingerprintOf(f), { effect: effectOf(before, after), rank: i + 1 });
    before = after;
  });
  return { byFix, overview: effectOf(base, before) };
}
