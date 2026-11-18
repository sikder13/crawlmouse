import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RUNBOOK_PATH,
  SPEC_PATH,
  prettierMarkdown,
  renderSpec,
  withGeneratedSection,
} from './render.js';
import {
  boundFor,
  knees,
  loadCapacity,
  loadLevels,
  renderCapacity,
  shipped,
  withCapacitySection,
} from './capacity.js';
import { MAX_BATCH_CONCURRENCY } from '../config.js';
import { MAX_RESULT_BYTES } from '../batch/store.js';

describe('generated documents', () => {
  it('docs/specs/v2/12-crawl-worker.md is exactly what the code renders', async () => {
    expect(readFileSync(SPEC_PATH, 'utf8')).toBe(await prettierMarkdown(renderSpec(), SPEC_PATH));
  });

  it("docs/ops/worker-runbook.md's verdict and capacity sections are exactly what the code renders", async () => {
    const runbook = readFileSync(RUNBOOK_PATH, 'utf8');
    expect(runbook).toBe(
      await prettierMarkdown(withCapacitySection(withGeneratedSection(runbook)), RUNBOOK_PATH),
    );
  });
});

describe('the capacity section', () => {
  const data = loadCapacity();
  const tomls = [
    readFileSync(new URL('../../fly.toml', import.meta.url), 'utf8'),
    readFileSync(new URL('../../fly.production.toml', import.meta.url), 'utf8'),
  ];

  it('names what both fly tomls ship, read from them, and refuses tomls that differ', () => {
    const md = renderCapacity(data);
    const s = shipped();
    expect(s.batchConcurrency).toBeLessThanOrEqual(MAX_BATCH_CONCURRENCY);
    expect(md).toContain(
      `\`BATCH_CONCURRENCY\` ${s.batchConcurrency} (the worker allows at most ${MAX_BATCH_CONCURRENCY}), on ${s.size} with ${s.memory} and a ${s.heapMb} MB heap`,
    );
    // A toml set to another value is what the section would say.
    const eight = tomls.map((t) =>
      t.replace(/BATCH_CONCURRENCY = "\d+"/, 'BATCH_CONCURRENCY = "8"'),
    );
    expect(renderCapacity(data, eight)).toContain('`BATCH_CONCURRENCY` 8 (');
    expect(() => shipped([tomls[0]!, eight[1]!])).toThrow(/different capacity/);
  });

  it('builds every table row from a measured row, with its wire gaps under 250 ms', () => {
    const md = renderCapacity(data);
    for (const r of data.rows) {
      expect(md).toContain(`| ${r.machine} | ${r.batches} |`);
      expect(md).toContain(`| ${r.wire_gaps_under_250} of ${r.wire_gaps} |`);
    }
  });

  it('places each knee at the first throttled level, whatever order the rows are in', () => {
    const m = data.rows[0]!.machine;
    const rows = data.rows.filter((r) => r.machine === m);
    const at = (pick: (n: number) => number) =>
      rows.map((r) => ({ ...r, throttle_max: pick(r.batches) }));
    expect(knees(at(() => 0))).toEqual([
      `- **${m}:** not throttled at any level, up to ${Math.max(...rows.map((r) => r.batches))}.`,
    ]);
    expect(knees(at((n) => (n >= 8 ? 50 : 0)).reverse())[0]).toContain('throttled at 8 (not at 4)');
    expect(knees(at(() => 3))[0]).toContain(
      `throttled at ${Math.min(...rows.map((r) => r.batches))} (at its first level)`,
    );
    expect(knees(at((n) => (n >= 16 ? 0.4 : 0)))[0]).toContain('throttled at 16 (not at 8)');
  });

  it("sets each level's bound from its highest measured peak, and the load test's levels from the bounds", () => {
    const levels = loadLevels(data);
    expect(levels.at(-1)).toBe(MAX_BATCH_CONCURRENCY);
    for (const n of levels) {
      const peaks = data.worst_case.runs.filter((r) => r.batches === n).map((r) => r.peak_rss_mib);
      expect(peaks.length).toBeGreaterThan(0);
      expect(data.worst_case.bound_mib[String(n)]).toBe(boundFor(Math.max(...peaks)));
    }
    // No measured run at a level without a bound.
    for (const r of data.worst_case.runs) expect(levels).toContain(r.batches);
  });

  it('describes the first-request gaps from the pairs measured, and says which part was inferred', () => {
    const md = renderCapacity(data);
    const f = data.first_requests;
    expect(md).toContain(`${f.arrival_gaps_under_250.length} arrival gaps under 250 ms`);
    const other = {
      ...data,
      first_requests: {
        ...f,
        arrival_gaps_under_250: f.arrival_gaps_under_250.map((g) => ({ ...g, first: '/x' })),
      },
    };
    expect(renderCapacity(other)).toContain('every one was `/x` then `/`');
    expect(md).toContain('not a figure measured for each of those gaps');
  });

  it('says the store does not hold the measured results when it would not', () => {
    const big = {
      ...data,
      worst_case: { ...data.worst_case, largest_result_bytes: 64 * 1024 * 1024 },
    };
    expect(renderCapacity(big)).toContain('does not hold');
    expect(renderCapacity(data)).toMatch(/which the store's \d+ MiB holds\./);
  });

  it('decides holds at the exact boundary: 16 × the largest × 2 equal to the store holds, a byte more does not', () => {
    const at = (bytes: number) =>
      renderCapacity({ ...data, worst_case: { ...data.worst_case, largest_result_bytes: bytes } });
    const exact = MAX_RESULT_BYTES / (MAX_BATCH_CONCURRENCY * 2);
    expect(Number.isInteger(exact)).toBe(true);
    expect(at(exact)).toMatch(/which the store's \d+ MiB holds\./);
    expect(at(exact + 1)).toContain('does not hold');
  });
});
