import { createHash } from 'node:crypto';
import type { CrawlFingerprint } from '@crawlmouse/types';
import { templateKeyFor } from './template-key.js';
import {
  FRONTIER_SAMPLING_SALT,
  FRONTIER_MAX_TEMPLATE_SHARE,
  FRONTIER_MIN_STRATA_FOR_CAP,
} from '../constants.js';

/**
 * SPEC 5.1a §6 — the deterministic stratified frontier.
 *
 * WHY BFS FAILED. Breadth-first is a fine discovery order and a terrible SAMPLING order when the budget
 * is far smaller than the site. The incumbent sorted each BFS level by canonical URL and truncated, so
 * one large index page's alphabetically-early children drained the whole budget. E1 is that failure in
 * production: duskroute.com, ten runs, every one at exactly 500 pages, F/32.88 to A−/88.89 — a
 * 56-point, six-letter swing with the page count held constant. Sample size cannot explain that.
 * Sample COMPOSITION can, and does.
 *
 * THE CONTRACT (§6.6). `selectFrontier` is a PURE FUNCTION of the discovered URL set and the fixed
 * seed. Forbidden inputs: wall-clock time, arrival order, concurrency outcomes, response latency.
 * Ties break by canonical URL. Politeness and adaptive backoff may change *timing* but must never
 * change *which* URLs are selected.
 *
 * WHAT THAT CAN AND CANNOT BUY, stated honestly because the distinction is the whole Stage 3 gate:
 * this makes SELECTION deterministic given a discovered set. It cannot make the DISCOVERED SET
 * deterministic against a live host — a budget-bounded crawl discovers as far as the host's latency
 * lets it, and that latency is outside our process (see the six-crawl control in
 * `evidence/2026-08-03-stage3-carry-forward.md`). B6 is therefore gated on a fixed discovered set fed
 * directly to this function, with live runs reported as evidence beside the site's own variance.
 */

export interface FrontierCandidate {
  /** Canonical URL identity. */
  url: string;
  /** Discovery depth (0 = seed). Kept so selection can prefer shallower pages within a stratum. */
  depth: number;
}

export interface FrontierSelection {
  /** The URLs to crawl, in a deterministic order. */
  selected: string[];
  fingerprint: CrawlFingerprint;
}

/**
 * §6.4 — the sample key: `sha256(SALT \0 canonicalUrl)`, taken as a hex string and compared as such.
 *
 * The key is a hash OF THE URL rather than a fresh random draw, which is the entire mechanism that
 * makes the grade reproducible: the same site yields the same sample no matter what order its pages
 * were discovered in. A reservoir sample with a real RNG would be uniform and useless here — it would
 * give a different answer every run, which is exactly the defect being fixed.
 *
 * The NUL separator (written as the ESCAPE `\u0000`, never a raw byte in source) stops
 * `salt+"ab"+"c"` colliding with `salt+"a"+"bc"`.
 */
export function sampleKey(url: string): string {
  return createHash('sha256').update(`${FRONTIER_SAMPLING_SALT}\u0000${url}`).digest('hex');
}

/** Stable, total ordering within a stratum: shallowest first, then smallest sample key, then URL. */
function compareCandidates(a: FrontierCandidate, b: FrontierCandidate): number {
  if (a.depth !== b.depth) return a.depth - b.depth;
  const ka = sampleKey(a.url);
  const kb = sampleKey(b.url);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
}

/**
 * Select up to `budget` URLs from the discovered set, stratified by template.
 *
 * §6.3 ROUND-ROBIN with per-template quotas: every discovered stratum gets its first slot before any
 * stratum gets a second, so a template can never consume more than a bounded share of the budget. That
 * guarantee is what stops one giant index page deciding the grade.
 *
 * §6.4 WITHIN an over-quota stratum, keep the smallest sample keys (the Efraimidis–Spirakis min-k
 * formulation). Because the key is a hash of the URL, the chosen subset is a property of the site
 * rather than of the run.
 *
 * The per-template share cap applies only once at least FRONTIER_MIN_STRATA_FOR_CAP strata exist.
 * Without that guard a single-template site — every page under `/p/{slug}` — would cap itself at a
 * fraction of the budget and crawl far less than it is entitled to, which would be a worse failure
 * than the one the cap prevents.
 */
export function selectFrontier(discovered: FrontierCandidate[], budget: number): FrontierSelection {
  // Dedupe by URL, keeping the SHALLOWEST depth seen. Depth is the only per-URL input, and taking the
  // shallowest makes the result independent of which discovery path arrived first.
  const byUrl = new Map<string, FrontierCandidate>();
  for (const c of discovered) {
    const prev = byUrl.get(c.url);
    if (!prev || c.depth < prev.depth) byUrl.set(c.url, c);
  }

  const strata = new Map<string, FrontierCandidate[]>();
  for (const c of byUrl.values()) {
    const key = templateKeyFor(c.url);
    const bucket = strata.get(key);
    if (bucket) bucket.push(c);
    else strata.set(key, [c]);
  }
  for (const bucket of strata.values()) bucket.sort(compareCandidates);

  // Strata are visited in key order, never insertion order — insertion order is arrival order wearing
  // a hat, and it would decide which stratum wins the last slot of the budget.
  const orderedKeys = [...strata.keys()].sort();
  const perTemplateCap =
    orderedKeys.length >= FRONTIER_MIN_STRATA_FOR_CAP
      ? Math.max(1, Math.floor(FRONTIER_MAX_TEMPLATE_SHARE * budget))
      : Number.POSITIVE_INFINITY;

  const selected: string[] = [];
  const taken = new Map<string, number>(orderedKeys.map((k) => [k, 0]));

  /**
   * One round-robin pass. `cap` bounds how much any single stratum may hold; Infinity disables it.
   * Returns whether it placed anything, so the caller can detect exhaustion rather than spin.
   */
  const roundRobin = (cap: number): boolean => {
    let progressed = false;
    for (const key of orderedKeys) {
      if (selected.length >= budget) break;
      const bucket = strata.get(key)!;
      const already = taken.get(key)!;
      if (already >= bucket.length || already >= cap) continue;
      selected.push(bucket[already]!.url);
      taken.set(key, already + 1);
      progressed = true;
    }
    return progressed;
  };

  // PHASE 1 — capped. Every stratum gets its first slot before any gets a second, and no stratum
  // exceeds its share while others still have pages to give. This is what stops one giant index
  // template deciding the grade (E1).
  while (selected.length < budget && roundRobin(perTemplateCap)) { /* keep filling */ }

  // PHASE 2 — UNCAPPED redistribution of whatever the cap left unspent.
  //
  // Found by the B7 budget test, not by reasoning: on the E1 shape (one 2000-page template plus a few
  // small ones) a HARD cap could only fill 180 of 500 slots and silently discarded the other 320. That
  // is a worse failure than the one the cap prevents — it is the thin-crawl problem this spec exists
  // to fix, self-inflicted. The cap's real job is priority, not scarcity: small strata are served
  // first and in full, and the dominant template receives only what is genuinely left over.
  while (selected.length < budget && roundRobin(Number.POSITIVE_INFINITY)) { /* spend the remainder */ }

  const strataTable = orderedKeys.map((key) => ({
    templateKey: key,
    discovered: strata.get(key)!.length,
    selected: taken.get(key)!,
  }));

  return {
    selected,
    fingerprint: {
      version: 1,
      discoveredCount: byUrl.size,
      selectedCount: selected.length,
      digest: crawlSetDigest(selected),
      strata: strataTable,
      seed: FRONTIER_SAMPLING_SALT,
    },
  };
}

/**
 * §6.7 — a stable digest over a sorted, deduped URL set.
 *
 * This is the artifact that finally separates "the site changed" from "we sampled differently":
 * identical digest + different grade is an ENGINE defect, and a different digest is an explained input
 * change with the strata table naming which sections moved. It exists because the racedays.run control
 * could not answer that question and was retired for it — two identical runs had been read as proof of
 * determinism when they were equally consistent with a site that had not changed yet.
 *
 * Sorted before hashing so arrival order cannot reach the digest; each URL terminated so that
 * ['ab','c'] and ['a','bc'] cannot collide.
 */
export function crawlSetDigest(urls: string[]): string {
  const h = createHash('sha256');
  for (const u of [...new Set(urls)].sort()) h.update(`${u}\n`);
  return h.digest('hex');
}
