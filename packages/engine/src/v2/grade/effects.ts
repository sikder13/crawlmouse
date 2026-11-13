/**
 * Each fix's effect on the two grades, by counterfactual recompute: apply what fixing it means to the
 * grade inputs, recompute, take the difference. Never typed.
 *
 * Order and sum. A shell-only template fix ranks first (`shellOnly`): a detected client-rendered
 * template fix whose template has no graded page, only empty-root pages (detectors/rendered.ts). Its
 * effect is 0 by construction, because Readable reads graded pages only, yet a template that serves
 * no text without JavaScript is the most serious AI-access finding a check makes (owner ruling on
 * CC-32 Q8); ties by fingerprint. Its counterfactual changes no graded page, so applying it first
 * moves no other fix's effect. Then fixes whose AI effect applied alone can be stated, by that effect
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
 * has no counterfactual here. A client-rendered template's fix moves Readable alone: its pages'
 * `text_share` becomes 1.
 *
 * Absorbed. A fix that alone would raise a grade (Technical SEO plus AI readability above 0) and whose
 * effect in the order is 0 or less was absorbed by a fix ranked above it. That fix is looked for among
 * the higher-ranked fixes that name a page, crawler or template the fix names (`touches`), in rank
 * order: the one whose application takes the effect from above 0 to 0 or less. When the effect is
 * gone before any such fix, a fix naming nothing it names took it (through the link graph, say), and
 * `absorbed_by` is left empty; it is also empty when none is found.
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
import type { RenderedDetection } from '../detectors/rendered.js';
import type { Detection } from '../detectors/types.js';
import { accessScore, crawlerShare, type CrawlerTally } from './access.js';
import { aiReadability } from './ai-readability.js';
import type { AiInputs } from './index.js';
import { round } from './numbers.js';
import { quotableScore } from './quotable.js';
import { readableScore } from './readable.js';
import { signalsScore } from './signals.js';
import { MAX_HEALTHY_DEPTH } from '../../constants.js';
import { canonicalizeUrl } from '../../url-canonical.js';
import { isGraded, seoParts, type TechnicalSeoInput } from './technical-seo.js';

export type FixRecord =
  | { family: 'structure'; record: Detection }
  | { family: 'access'; record: AccessDetection }
  | { family: 'content'; record: ContentDetection }
  | { family: 'rendered'; record: RenderedDetection };

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
export function shallowParent(
  seo: Pick<TechnicalSeoInput, 'pages' | 'edges' | 'homepage_url'>,
): string {
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

/** The final URL of the request for `url`, in the engine's spelling; null when unknown. */
function landedAt(seo: TechnicalSeoInput, url: string): string | null {
  const final = seo.pages.find((p) => p.url === url)?.final_url ?? null;
  if (final === null) return null;
  try {
    const spelled = canonicalizeUrl(final);
    return spelled === url ? null : spelled;
  } catch {
    return null;
  }
}

/**
 * The redirect fix: links to `url` point straight at where it redirects, so `url` leaves the crawl
 * (owner ruling, 2026-11-05). The worker stores a requested URL with its final response's status and
 * the landed page's links, so a followed chain is a row answering 200 and a node of the graph:
 *   - when the final URL is known and was crawled as its own row, links to `url` move to it, and the
 *     row for `url` and the links filed under it (the landed page's, a second time) go;
 *   - when it is known and was not crawled, the row becomes the final URL, with its links;
 *   - otherwise (a chain the crawl stopped, or a loop) the row goes, and links to it stay where they
 *     were: they are not graph edges, since the row does not answer 200.
 */
function linkedStraight(seo: TechnicalSeoInput, url: string): TechnicalSeoInput {
  const final = landedAt(seo, url);
  const row = seo.pages.find((p) => p.url === url);
  if (row === undefined) return seo;
  if (final === null || row.status_code !== 200)
    return { ...seo, pages: seo.pages.filter((p) => p !== row) };
  const crawled = seo.pages.some((p) => p.url === final);
  const to = (u: string) => (u === url ? final : u);
  const edges = seo.edges
    .filter((e) => !(crawled && e.from_url === url))
    .map((e) => ({ ...e, from_url: to(e.from_url), to_url: to(e.to_url) }))
    .filter((e) => e.from_url !== e.to_url);
  // a page that linked both the redirecting URL and the final one now links the final one twice
  const seen = new Set<string>();
  const unique = edges.filter((e) => {
    const k = `${e.from_url}\u0000${e.to_url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const pages = crawled
    ? seo.pages.filter((p) => p !== row)
    : seo.pages.map((p) =>
        p === row ? { ...p, url: final, final_url: final, redirect: null } : p,
      );
  return { ...seo, pages, edges: unique, homepage_url: to(seo.homepage_url) };
}

const cleared = (seo: TechnicalSeoInput, fingerprint: string): TechnicalSeoInput => ({
  ...seo,
  detections: seo.detections.map((d) =>
    d.fingerprint === fingerprint ? { ...d, state: 'not_detected' as const } : d,
  ),
});

/**
 * The edge fix's counterfactual on its crawler's tally: served, and reading the text, on the pages a
 * user-agent rule blocked it on. The fix's before and after reads it too (packets/before-after.ts).
 */
export function servedAll(c: CrawlerTally): CrawlerTally {
  const blocked = c.counts.blocked_by_ua_rule ?? 0;
  return {
    ...c,
    counts: { ...c.counts, blocked_by_ua_rule: 0, allowed: (c.counts.allowed ?? 0) + blocked },
  };
}

/**
 * The content fix's counterfactual on its check's tally: the `failing` pages pass. The fix's before
 * and after reads it too (packets/before-after.ts).
 */
export const allPassing = <T extends { passing: number }>(tally: T, failing: number): T => ({
  ...tally,
  passing: tally.passing + failing,
});

/** The text share of a page once its template is rendered on the server: the whole text. */
export const SERVER_RENDERED_SHARE = 1;

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
      [f.record.check]: allPassing(t, f.record.extent.failing),
    };
    return { seo, ai: { ...ai, quotable: { checks } } };
  }
  if (f.family === 'rendered') {
    // The render step keeps no link, so only the client-rendered template has a counterfactual: the
    // template's graded pages serve their words without JavaScript, rendered this check or not.
    if (f.record.type !== 'client_rendered_template') {
      throw new Error(`effects: no counterfactual for ${f.record.type}`);
    }
    const template = f.record.template_key;
    return {
      seo,
      ai: {
        ...ai,
        readable: ai.readable.map((p) =>
          p.template_key === template ? { ...p, text_share: SERVER_RENDERED_SHARE } : p,
        ),
      },
    };
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
    case 'redirect_chain':
      return { seo: linkedStraight(cleared(seo, r.fingerprint), url), ai };
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
  // a withheld grade names its reasons, so waits already holds them; the test narrows the types
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

/** A detected client-rendered template fix whose template has no graded page (see Order and sum). */
export const shellOnly = (f: FixRecord): boolean =>
  f.family === 'rendered' &&
  f.record.type === 'client_rendered_template' &&
  f.record.state === 'detected' &&
  f.record.extent.graded === 0;

/** Both grades' points, an effect not estimated counting 0. */
const sizeOf = (e: Effect) => (e.technical_seo ?? 0) + (e.ai_readability ?? 0);

const fingerprintOf = (f: FixRecord) => f.record.fingerprint;

/** What a fix names: its pages, its crawler or its template. */
function names(f: FixRecord): Set<string> {
  if (f.family === 'access') return new Set([`crawler:${f.record.crawler}`]);
  if (f.family === 'content' || f.family === 'rendered') {
    return new Set([`template:${f.record.template_key}`]);
  }
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
      Number(shellOnly(y.f)) - Number(shellOnly(x.f)) ||
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
      // f's effect with the first k fixes applied, k ≤ i
      const at = (k: number) =>
        sizeOf(effect(scores[k]!, scoresOf(apply(states[k]!, f)), [f], states[k]!));
      for (let j = 0; j < i; j++) {
        const g = alone[j]!.f;
        if (!touches(f, g)) continue;
        // g took the effect when f still had some before g and none after it; an effect already gone
        // before g went to a fix that names nothing f names, which is left unattributed
        if (at(j) <= 0) break;
        if (at(j + 1) <= 0) {
          absorbed_by = fingerprintOf(g);
          break;
        }
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
