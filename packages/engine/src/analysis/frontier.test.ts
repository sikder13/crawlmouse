import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { selectFrontier, sampleKey, crawlSetDigest, type FrontierCandidate, fingerprintFor } from './frontier.js';
import { FRONTIER_MAX_TEMPLATE_SHARE, FRONTIER_MIN_STRATA_FOR_CAP, FRONTIER_SAMPLING_SALT } from '../constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §6 — the deterministic stratified frontier. THIS IS THE B6 GATE.
//
// The gate runs against a FIXED DISCOVERED SET fed straight to the selector: no crawl, no host, no
// clock. That is deliberate and it is the finding from Stage 1's six-crawl control — a budget-bounded
// crawl discovers as far as the remote host's latency allows, and that latency lives outside our
// process, so a live-site run can neither prove nor disprove determinism. Selection is what we can
// make deterministic, so selection is what we gate.
// ─────────────────────────────────────────────────────────────────────────────

const HOME = 'https://s.test';
const c = (url: string, depth = 1): FrontierCandidate => ({ url, depth });

/** A duskroute-shaped site: one enormous template plus a few small ones. This is the E1 shape. */
const duskrouteShaped = (): FrontierCandidate[] => [
  c(`${HOME}/`, 0),
  ...Array.from({ length: 2000 }, (_, i) => c(`${HOME}/listing/item-${String(i).padStart(5, '0')}`, 1)),
  ...Array.from({ length: 40 }, (_, i) => c(`${HOME}/guide/topic-${i}`, 1)),
  ...Array.from({ length: 12 }, (_, i) => c(`${HOME}/about/section-${i}`, 2)),
  c(`${HOME}/pricing`, 1),
  c(`${HOME}/contact`, 1),
];

describe('B6 — determinism against a FIXED discovered set', () => {
  it('two selections over the same set and seed are byte-identical', () => {
    const set = duskrouteShaped();
    const a = selectFrontier(set, 500);
    const b = selectFrontier(set, 500);
    expect(a.selected).toEqual(b.selected);
    expect(a.fingerprint.digest).toBe(b.fingerprint.digest);
  });

  it('SHUFFLING the discovered set changes nothing — arrival order is a forbidden input (§6.6)', () => {
    // The property that actually matters. A crawl discovers pages in whatever order the network
    // returns them; if that reached the selection, the grade would move with the weather.
    const set = duskrouteShaped();
    const base = selectFrontier(set, 500);
    // A deterministic permutation: reverse, then rotate. No RNG — the test must not be flaky either.
    const shuffled = [...set].reverse();
    shuffled.push(...shuffled.splice(0, 137));
    const permuted = selectFrontier(shuffled, 500);
    expect(permuted.selected).toEqual(base.selected);
    expect(permuted.fingerprint.digest).toBe(base.fingerprint.digest);
  });

  it('is insensitive to duplicate discovery of the same URL', () => {
    const set = duskrouteShaped();
    const withDupes = [...set, ...set.slice(0, 300)];
    expect(selectFrontier(withDupes, 500).fingerprint.digest).toBe(selectFrontier(set, 500).fingerprint.digest);
  });

  it('keeps the shallowest depth when a URL is discovered twice, regardless of which arrived first', () => {
    // FIXTURE FIXED, NOT ASSERTION. The previous version fed ONE url at budget 10, where the result
    // is `['/x']` for every implementation — depth could not vary, so it asserted nothing. Three
    // mutations proved it: dropping the shallowest-wins dedupe here, dropping it in the crawler's
    // pool, and deleting the depth term from `compareCandidates` each passed all 826 engine tests.
    //
    // The stratum is now OVER-SUBSCRIBED (budget 2 of 3), so depth decides WHO SURVIVES.
    const deepFirst = [c(`${HOME}/p/1`, 9), c(`${HOME}/p/1`, 1), c(`${HOME}/p/2`, 2), c(`${HOME}/p/3`, 8)];
    const shallowFirst = [c(`${HOME}/p/1`, 1), c(`${HOME}/p/1`, 9), c(`${HOME}/p/2`, 2), c(`${HOME}/p/3`, 8)];
    // /p/1 is really depth 1 once deduped, so it and /p/2 are the two shallowest and /p/3 is dropped.
    const selected = selectFrontier(deepFirst, 2).selected;
    expect(selected).toContain(`${HOME}/p/1`);
    expect(selected).toContain(`${HOME}/p/2`);
    expect(selected).not.toContain(`${HOME}/p/3`);
    // ...and arrival order of the duplicate cannot change it.
    expect(selectFrontier(shallowFirst, 2).selected).toEqual(selected);
  });

  it('orders WITHIN a stratum by depth — shallowest first, which is what the dedupe feeds', () => {
    // Pins `compareCandidates`'s depth term directly: deleting it left every test green.
    const set = [c(`${HOME}/p/9`, 9), c(`${HOME}/p/5`, 5), c(`${HOME}/p/1`, 1)];
    expect(selectFrontier(set, 1).selected).toEqual([`${HOME}/p/1`]);
    expect(selectFrontier(set, 2).selected).toEqual([`${HOME}/p/1`, `${HOME}/p/5`]);
  });
});

describe('B8 — the E1 replay: one giant template can no longer drain the budget', () => {
  it('BOUNDS the giant stratum instead of letting it take everything', () => {
    // THE DEFECT THIS REPLACES: level-sorted BFS truncation gave the 2000-item listing template every
    // slot after the homepage, because its children sort alphabetically ahead of everything else. The
    // guide, about, pricing and contact pages were never seen, and which 500 listings you got decided
    // the grade.
    // The claim is PRIORITY, not scarcity: every small stratum is served FIRST and IN FULL, and the
    // dominant template gets only what is genuinely left over. Asserting "listings <= 25% of budget"
    // would be asserting that we throw budget away — see the phase-2 note in frontier.ts.
    const sel = selectFrontier(duskrouteShaped(), 500);
    expect(sel.selected.filter((u) => u.includes('/guide/'))).toHaveLength(40);   // all 40
    expect(sel.selected.filter((u) => u.includes('/about/'))).toHaveLength(12);   // all 12
    expect(sel.selected).toHaveLength(500);                                        // budget fully spent
    expect(sel.selected).toContain(`${HOME}/pricing`);
    expect(sel.selected).toContain(`${HOME}/contact`);
    expect(sel.selected.some((u) => u.includes('/guide/'))).toBe(true);
    expect(sel.selected.some((u) => u.includes('/about/'))).toBe(true);
  });

  it('demonstrates what the incumbent did, so the improvement is measured not asserted', () => {
    // The incumbent's rule, reproduced exactly: sort the level by canonical URL and truncate.
    const set = duskrouteShaped();
    const incumbent = [...set].map((x) => x.url).sort().slice(0, 500);
    const incumbentListings = incumbent.filter((u) => u.includes('/listing/')).length;
    const nowListings = selectFrontier(set, 500).selected.filter((u) => u.includes('/listing/')).length;
    expect(incumbentListings).toBeGreaterThan(400);   // the giant template took almost everything
    expect(nowListings).toBeLessThan(incumbentListings);
    // The incumbent never reached /pricing at all.
    expect(incumbent).not.toContain(`${HOME}/pricing`);
  });
});

describe('B7 — stratification quotas', () => {
  it('gives EVERY discovered stratum a slot before any stratum gets a second', () => {
    const set = [
      ...Array.from({ length: 50 }, (_, i) => c(`${HOME}/a/x-${i}`)),
      ...Array.from({ length: 50 }, (_, i) => c(`${HOME}/b/x-${i}`)),
      ...Array.from({ length: 50 }, (_, i) => c(`${HOME}/c/x-${i}`)),
      ...Array.from({ length: 50 }, (_, i) => c(`${HOME}/d/x-${i}`)),
    ];
    const first4 = selectFrontier(set, 4).selected.map((u) => u.split('/')[3]);
    expect(new Set(first4).size).toBe(4); // one from each stratum, not four from one
  });

  it('does NOT cap a single-template site — the guard that prevents self-starvation', () => {
    // Every page under one template. With the share cap applied unconditionally this site would crawl
    // 125 of its 400 pages and report a thin crawl, which is a worse failure than the one the cap
    // prevents.
    const set = Array.from({ length: 400 }, (_, i) => c(`${HOME}/p/post-${i}`));
    expect(selectFrontier(set, 300).selected).toHaveLength(300);
  });

  it('applies the cap once the stratum count reaches the documented threshold', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) =>
      Array.from({ length: 100 }, (_, j) => c(`${HOME}/s${i}/x-${j}`))).flat();
    const under = selectFrontier(mk(FRONTIER_MIN_STRATA_FOR_CAP - 1), 100);
    const at = selectFrontier(mk(FRONTIER_MIN_STRATA_FOR_CAP), 100);
    const cap = Math.floor(FRONTIER_MAX_TEMPLATE_SHARE * 100);
    const maxPer = (sel: string[]) => Math.max(...[...new Set(sel.map((u) => u.split('/')[3]))]
      .map((s) => sel.filter((u) => u.includes(`/${s}/`)).length));
    expect(maxPer(under.selected)).toBeGreaterThan(cap);
    expect(maxPer(at.selected)).toBeLessThanOrEqual(cap);
  });

  it('never selects more than the budget, and never invents a URL', () => {
    const set = duskrouteShaped();
    const sel = selectFrontier(set, 500);
    expect(sel.selected).toHaveLength(500);
    const known = new Set(set.map((x) => x.url));
    for (const u of sel.selected) expect(known.has(u)).toBe(true);
    expect(new Set(sel.selected).size).toBe(sel.selected.length); // no duplicates
  });

  it('returns everything when the budget exceeds the site', () => {
    const set = [c(`${HOME}/`, 0), c(`${HOME}/a`), c(`${HOME}/b`)];
    expect(selectFrontier(set, 500).selected).toHaveLength(3);
  });

  it('handles an empty discovered set', () => {
    const sel = selectFrontier([], 500);
    expect(sel.selected).toEqual([]);
    expect(sel.fingerprint.discoveredCount).toBe(0);
  });
});

describe('§6.4 sampleKey', () => {
  it('is a pure function of the URL and the fixed salt', () => {
    expect(sampleKey(`${HOME}/a`)).toBe(sampleKey(`${HOME}/a`));
    expect(sampleKey(`${HOME}/a`)).not.toBe(sampleKey(`${HOME}/b`));
  });

  it('is pinned against an independently computed digest, not against its own output', () => {
    // Recomputed here from the documented construction rather than by calling the module under test.
    // A test that compares an implementation to itself passes for any implementation.
    const expected = createHash('sha256')
      .update(`${FRONTIER_SAMPLING_SALT}\0${HOME}/a`).digest('hex');
    expect(sampleKey(`${HOME}/a`)).toBe(expected);
  });
});

describe('§6.7 fingerprint', () => {
  it('reports discovered and selected counts separately — they are different facts', () => {
    const sel = selectFrontier(duskrouteShaped(), 500);
    expect(sel.fingerprint.discoveredCount).toBe(2055);
    expect(sel.fingerprint.selectedCount).toBe(500);
  });

  it('names which strata were seen and how much of each was taken', () => {
    const sel = selectFrontier(duskrouteShaped(), 500);
    const listing = sel.fingerprint.strata.find((s) => s.templateKey === '/listing/{slug}')!;
    expect(listing.discovered).toBe(2000);
    // It takes the remainder after every other stratum is exhausted — 500 - (1+40+12+1+1) = 445.
    expect(listing.selected).toBe(445);
    // The strata table is what turns "the grade moved" into "this section moved".
    expect(sel.fingerprint.strata.map((s) => s.templateKey)).toEqual([...sel.fingerprint.strata.map((s) => s.templateKey)].sort());
  });

  it('records the seed, so a future salt change is visible in old audits', () => {
    expect(selectFrontier([c(`${HOME}/a`)], 10).fingerprint.seed).toBe(FRONTIER_SAMPLING_SALT);
  });

  it('digests identical sets identically and different sets differently', () => {
    expect(crawlSetDigest([`${HOME}/b`, `${HOME}/a`])).toBe(crawlSetDigest([`${HOME}/a`, `${HOME}/b`]));
    expect(crawlSetDigest([`${HOME}/a`])).not.toBe(crawlSetDigest([`${HOME}/a`, `${HOME}/b`]));
  });
});

// R1 N6 — the fingerprint must not be able to describe itself inconsistently. `selectedCount` and the
// strata table are computed from different sets, so a selected URL absent from the discovered set
// inflates the count without appearing in any stratum row. Unreachable from the crawler (`admitted` is
// always a subset), but this artifact is what adjudicates "engine defect vs different sample", and
// reasoning from a self-inconsistent one is the wrong failure mode to leave open.
describe('the fingerprint is internally consistent', () => {
  it('never reports a selectedCount the strata table cannot account for', () => {
    const fp = fingerprintFor(
      [{ url: `${HOME}/a`, depth: 0 }, { url: `${HOME}/b`, depth: 1 }],
      [`${HOME}/a`, `${HOME}/b`],
    );
    const strataSelected = fp.strata.reduce((n, s) => n + s.selected, 0);
    expect(strataSelected).toBe(fp.selectedCount);
    const strataDiscovered = fp.strata.reduce((n, s) => n + s.discovered, 0);
    expect(strataDiscovered).toBe(fp.discoveredCount);
  });
});
