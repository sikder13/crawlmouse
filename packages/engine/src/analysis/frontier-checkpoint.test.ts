import { describe, it, expect } from 'vitest';
import {
  frontierRecord,
  resumeSelection,
  pendingAfterResume,
  claimOrder,
  restorePoliteness,
  capDiscovered,
  discoveryCapInfo,
  type FrontierRecord,
} from './frontier-checkpoint.js';
import { selectFrontier } from './frontier.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §8 — STAGE 5'S B6: DETERMINISM ACROSS A RESUME.
//
// This is Stage 5's acceptance criterion, not a nice-to-have. A checkpoint that lets a timed-out crawl
// resume is worthless — worse than worthless — if the resumed crawl grades a different sample than the
// straight-through one would have. That would reintroduce, through the back door, exactly the
// composition drift SPEC 5.1 exists to remove: two runs of the same site, same page count, different
// grade, and nothing in the output able to explain it.
//
// THE NAIVE IMPLEMENTATION THIS IS WRITTEN AGAINST. The obvious resume is "select from what is LEFT" —
// on waking, look at the frontier rows that are not yet fetched and choose from those. It is wrong,
// and it is wrong in a way no amount of care in the selection function can fix: `selectFrontier` is a
// pure function of the set it is GIVEN, so feeding it the remainder feeds it a different set. The
// stratified round-robin then re-balances quotas across strata that have already been partly consumed,
// and the final selected set diverges from the one a straight-through run would have produced.
//
// THE FIX, per §8: "selection is a function of the discovered set, so discovery and selection must be
// separable — bound discovery deterministically, then select." So the checkpoint persists EVERY URL
// ever discovered, and a resume re-runs selection over that COMPLETE set. Already-fetched rows are
// then subtracted from the WORK, never from the SELECTION BASIS.
//
// SCOPE, stated honestly. This proves selection determinism across a resume GIVEN the same discovered
// set. It does not — and cannot — prove the discovered set is itself identical against a live host: a
// budget-bounded crawl discovers as far as the host's latency allows, and that latency is outside our
// process. That limit is already recorded in frontier.ts's header and in
// evidence/2026-08-03-stage3-carry-forward.md, and it is why B6 is gated on a fixed discovered set.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A discovered set with several strata of different sizes — the shape where the round-robin quota
 * actually bites. A single-stratum fixture would pass any implementation, including the naive one.
 */
function discoveredSet(): FrontierRecord[] {
  const recs: FrontierRecord[] = [];
  // A big listing template, a medium article template, and two small ones.
  for (let i = 0; i < 30; i++) recs.push(frontierRecord(`https://x.test/listing/item-${i}`, 2, 'link'));
  for (let i = 0; i < 12; i++) recs.push(frontierRecord(`https://x.test/article/post-${i}`, 1, 'link'));
  for (let i = 0; i < 4; i++) recs.push(frontierRecord(`https://x.test/guide/g-${i}`, 1, 'sitemap'));
  recs.push(frontierRecord('https://x.test/', 0, 'homepage'));
  return recs;
}

const BUDGET = 12;

describe('B6 — a resumed crawl selects the SAME pages as a straight-through one', () => {
  it('THE ACCEPTANCE CRITERION: identical fingerprint digest, interrupted vs straight through', () => {
    const all = discoveredSet();

    // (1) Straight through: everything discovered, then selected once.
    const straight = resumeSelection(all, BUDGET);

    // (2) Interrupted. Discovery got as far as 25 URLs, selection ran, and SIX of the chosen pages
    //     were actually fetched before the wall-clock budget cut the run short.
    const wave1 = all.slice(0, 25);
    const firstPass = resumeSelection(wave1, BUDGET);
    const fetched = new Set(firstPass.selected.slice(0, 6));
    const persisted: FrontierRecord[] = all.map((r) =>
      fetched.has(r.url) ? { ...r, state: 'fetched' } : r,
    );

    // (3) Resumed: discovery completes to the same set, and selection re-runs over ALL of it.
    const resumed = resumeSelection(persisted, BUDGET);

    // THE assertion. The digest is over the selected URL set, so equality here is equality of sample.
    expect(resumed.fingerprint.digest).toBe(straight.fingerprint.digest);
    expect(resumed.selected).toEqual(straight.selected);
  });

  it('THE NAIVE IMPLEMENTATION IS WRONG, and this proves it rather than asserting it', () => {
    // Selecting from what is LEFT — the obvious resume — is reproduced here directly. If this
    // produced the same digest, the test above would be vacuous and would pass on a broken build.
    const all = discoveredSet();
    const straight = resumeSelection(all, BUDGET);

    const firstPass = resumeSelection(all.slice(0, 25), BUDGET);
    const fetched = new Set(firstPass.selected.slice(0, 6));
    const remainderOnly = all.filter((r) => !fetched.has(r.url));

    const naive = resumeSelection(remainderOnly, BUDGET);
    expect(naive.fingerprint.digest).not.toBe(straight.fingerprint.digest);
  });

  it('subtracts fetched rows from the WORK, never from the selection basis', () => {
    const all = discoveredSet();
    const straight = resumeSelection(all, BUDGET);
    const fetched = new Set(straight.selected.slice(0, 5));
    const persisted = all.map((r) => (fetched.has(r.url) ? { ...r, state: 'fetched' as const } : r));

    const pending = pendingAfterResume(persisted, BUDGET);
    // Exactly the selected pages that are not yet fetched — no more, no fewer, same order.
    expect(pending).toEqual(straight.selected.filter((u) => !fetched.has(u)));
    // And the union still reconstructs the full selection: nothing was lost by resuming.
    expect([...fetched, ...pending].sort()).toEqual([...straight.selected].sort());
  });

  it('is idempotent — resuming twice changes nothing', () => {
    const all = discoveredSet();
    const once = resumeSelection(all, BUDGET);
    const twice = resumeSelection(all.map((r) => ({ ...r })), BUDGET);
    expect(twice.selected).toEqual(once.selected);
    expect(twice.fingerprint.digest).toBe(once.fingerprint.digest);
  });

  it('is unaffected by the ORDER rows come back from the database', () => {
    // A resume reads rows through Postgres, which guarantees no order without ORDER BY. Arrival order
    // is a forbidden input (§6.6), so a shuffled read must not move a single selected URL.
    const all = discoveredSet();
    const straight = resumeSelection(all, BUDGET);
    const shuffled = [...all].reverse();
    expect(resumeSelection(shuffled, BUDGET).selected).toEqual(straight.selected);
  });

  it('is unaffected by which rows a parallel worker happened to claim', () => {
    // FOR UPDATE SKIP LOCKED means two steps claim DISJOINT rows, and which worker gets which is a
    // race. That may change who fetches what; it must never change WHAT IS SELECTED.
    const all = discoveredSet();
    const straight = resumeSelection(all, BUDGET);
    const withClaims = all.map((r, i) => (i % 3 === 0 ? { ...r, state: 'claimed' as const } : r));
    expect(resumeSelection(withClaims, BUDGET).selected).toEqual(straight.selected);
  });

  it('keeps a failed fetch in the basis — a dead URL was still discovered', () => {
    // Dropping it would shrink the discovered set and re-balance every stratum quota around the gap,
    // which is the naive bug wearing a different hat.
    const all = discoveredSet();
    const straight = resumeSelection(all, BUDGET);
    const withFailure = all.map((r, i) => (i === 3 ? { ...r, state: 'failed' as const } : r));
    expect(resumeSelection(withFailure, BUDGET).selected).toEqual(straight.selected);
  });
});

describe('the record itself', () => {
  it('derives templateKey and sampleKey from the URL, so they survive a round trip', () => {
    const r = frontierRecord('https://x.test/article/post-1', 1, 'link');
    expect(r.templateKey.length).toBeGreaterThan(0);
    expect(r.sampleKey).toMatch(/^[0-9a-f]{64}$/);
    expect(r.urlHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.state).toBe('discovered');
    expect(r.source).toBe('link');
  });

  it('gives the same url the same hash and key every time — the row identity is stable', () => {
    expect(frontierRecord('https://x.test/a', 1, 'link').urlHash)
      .toBe(frontierRecord('https://x.test/a', 9, 'sitemap').urlHash);
    expect(frontierRecord('https://x.test/a', 1, 'link').sampleKey)
      .toBe(frontierRecord('https://x.test/a', 9, 'sitemap').sampleKey);
  });
});

describe('claim ordering', () => {
  it('is the SELECTION order, so a claim never reorders the crawl', () => {
    const all = discoveredSet();
    const sel = resumeSelection(all, BUDGET);
    expect(claimOrder(all, BUDGET)).toEqual(sel.selected);
  });

  it('excludes rows already fetched or in flight, so no page is fetched twice', () => {
    const all = discoveredSet();
    const sel = resumeSelection(all, BUDGET);
    const marked = all.map((r) =>
      r.url === sel.selected[0] ? { ...r, state: 'fetched' as const }
      : r.url === sel.selected[1] ? { ...r, state: 'claimed' as const }
      : r,
    );
    const order = claimOrder(marked, BUDGET);
    expect(order).not.toContain(sel.selected[0]);
    expect(order).not.toContain(sel.selected[1]);
    expect(order).toEqual(sel.selected.slice(2));
  });
});

describe('agreement with the one-shot selector', () => {
  it('resumeSelection over a fresh set IS selectFrontier — one selection rule, not two', () => {
    // The checkpoint must not become a second implementation of §6. Pinned against the real selector
    // rather than against itself, so a divergence shows up here instead of in production grades.
    const all = discoveredSet();
    const direct = selectFrontier(all.map((r) => ({ url: r.url, depth: r.depth })), BUDGET);
    expect(resumeSelection(all, BUDGET).selected).toEqual(direct.selected);
    expect(resumeSelection(all, BUDGET).fingerprint.digest).toBe(direct.fingerprint.digest);
  });
});

describe('§8 — per-host politeness survives a resume', () => {
  const saved = { host: 'x.test', crawlDelayMs: 2000, backoffUntil: 10_000, consecutive429s: 3 };

  it('keeps an ACTIVE backoff — the host asked us to wait and the interruption does not excuse it', () => {
    const r = restorePoliteness(saved, 5_000);
    expect(r.backoffUntil).toBe(10_000);
  });

  it('clears an EXPIRED backoff rather than waiting on last run’s clock', () => {
    expect(restorePoliteness(saved, 20_000).backoffUntil).toBeNull();
  });

  it('keeps the crawl-delay and the 429 count — those describe the HOST, not the run', () => {
    // Resetting them is how a resume walks straight back into the throttle it just earned, and turns
    // a temporary 429 into a durable block that would later read as the site's own configuration.
    const r = restorePoliteness(saved, 20_000);
    expect(r.crawlDelayMs).toBe(2000);
    expect(r.consecutive429s).toBe(3);
  });

  it('never reaches the selection — politeness changes timing, never WHICH urls (§6.6)', () => {
    // Pinned as a property of the module surface: resumeSelection takes no politeness argument, so a
    // future edit that threaded one in would have to change this signature and this test.
    expect(resumeSelection.length).toBe(2); // (all, budget) — nothing else
  });
});

describe('§8 — the discovery cap is deterministic and SELF-DECLARING', () => {
  const big = (n: number): FrontierRecord[] =>
    Array.from({ length: n }, (_, i) => frontierRecord(`https://x.test/p/${i}`, 1, 'link'));

  it('keeps the smallest sample keys — a property of the SITE, not of the run', () => {
    const all = big(500);
    const capped = capDiscovered(all, 100);
    expect(capped).toHaveLength(100);
    const keys = capped.map((r) => r.sampleKey).sort();
    const expected = all.map((r) => r.sampleKey).sort().slice(0, 100);
    expect(keys).toEqual(expected);
  });

  it('is INDEPENDENT OF ARRIVAL ORDER — the naive "first N discovered" cap is forbidden', () => {
    // Arrival order is concurrency and host latency wearing a hat (§6.6). A prefix cap would keep a
    // different subset every run and grade a different sample — the failure a cap should prevent.
    const all = big(500);
    const forward = capDiscovered(all, 100).map((r) => r.url).sort();
    const reversed = capDiscovered([...all].reverse(), 100).map((r) => r.url).sort();
    expect(reversed).toEqual(forward);
    // And it is NOT simply the first 100 discovered.
    expect(capDiscovered(all, 100).map((r) => r.url).sort())
      .not.toEqual(all.slice(0, 100).map((r) => r.url).sort());
  });

  it('is a no-op below the cap, and returns the SAME array identity', () => {
    const all = big(50);
    expect(capDiscovered(all, 100)).toBe(all);
  });

  it('DECLARES itself, and is absent rather than false when uncapped', () => {
    // Absent-not-false so an old fingerprint cannot masquerade as a capped one, or the reverse.
    expect(discoveryCapInfo(100_684, 25_000)).toEqual({ discoveryCapped: true, discoveredAtCap: 100_684 });
    expect(discoveryCapInfo(3_539, 25_000)).toEqual({});
    expect('discoveryCapped' in discoveryCapInfo(3_539, 25_000)).toBe(false);
  });

  it('keeps a capped crawl resume-stable — the cap and B6 do not fight', () => {
    // The cap bounds what is DISCOVERED; B6 forbids shrinking the basis relative to what was
    // discovered. Both hold at once: cap first, then select over the whole capped set, fresh or resumed.
    const all = big(500);
    const capped = capDiscovered(all, 100);
    const straight = resumeSelection(capped, 20);
    const fetched = new Set(straight.selected.slice(0, 8));
    const resumed = resumeSelection(
      capped.map((r) => (fetched.has(r.url) ? { ...r, state: 'fetched' as const } : r)),
      20,
    );
    expect(resumed.fingerprint.digest).toBe(straight.fingerprint.digest);
  });

  it('MEASURED: whether capping moves the sample is SHAPE-DEPENDENT, not uniform', () => {
    // Measured, and it corrected a wrong assumption. The first version of this test asserted the cap
    // always changes the selection; on a SINGLE-STRATUM set it does not, because the cap keeps the
    // smallest sample keys and selection draws in that same min-k order — the survivors are exactly
    // the pages selection wanted. Fixed the fixture rather than the assertion.
    //
    // `/p/{n}` collapses to ONE stratum (numeric segments group), so the cap is a no-op on selection.
    const oneStratum = big(5000);
    expect(resumeSelection(capDiscovered(oneStratum, 1000), 500).fingerprint.digest)
      .toBe(resumeSelection(oneStratum, 500).fingerprint.digest);
  });

  it('MEASURED: on a ONE-STRATUM-PER-URL site the cap replaces most of the sample', () => {
    // The shape that matters, because it is the shape of every site that hits the cap in the live
    // corpus: Wikipedia, whose `/wiki/Foo_Bar` yields `/wiki/foo_bar` — one stratum per article.
    // A global smallest-key cut then wipes out whole strata, the round-robin re-balances across what
    // is left, and the selection barely overlaps the uncapped one.
    //
    // THIS IS WHY THE CAP IS NOT A STAGE 5 STORAGE GUARD. It is a grade-moving change and therefore an
    // owner decision (5.1b) — recorded here so nobody later switches it on as an optimisation.
    const perUrl = Array.from({ length: 5000 }, (_, i) => frontierRecord(`https://x.test/u/x${i}`, 1, 'link'));
    const uncapped = resumeSelection(perUrl, 500);
    const capped = resumeSelection(capDiscovered(perUrl, 1000), 500);
    expect(capped.fingerprint.digest).not.toBe(uncapped.fingerprint.digest);
    const overlap = capped.selected.filter((u) => uncapped.selected.includes(u)).length;
    // Measured at ~111/500. Asserted as a BOUND, not the exact number, so the test pins the finding
    // ("most of the sample is replaced") without breaking on an unrelated ordering change.
    expect(overlap).toBeLessThan(uncapped.selected.length / 2);
  });
});
