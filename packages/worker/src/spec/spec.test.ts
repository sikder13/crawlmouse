import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RUNBOOK_PATH,
  SPEC_PATH,
  prettierMarkdown,
  renderSpec,
  withGeneratedSection,
} from './render.js';
import { loadCapacity, renderCapacity, shippedMachine, withCapacitySection } from './capacity.js';
import { MAX_BATCH_CONCURRENCY } from '../config.js';

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

  it('names the limit, machine and heap that ship, read from config.ts and fly.toml', () => {
    const md = renderCapacity(data);
    const m = shippedMachine();
    expect(md).toContain(
      `\`BATCH_CONCURRENCY\` ${MAX_BATCH_CONCURRENCY}, the most the worker allows, on ${m.size} with ${m.memory} and a ${m.heapMb} MB heap`,
    );
  });

  it('builds every table row from a measured row, and a knee line for each machine measured', () => {
    const md = renderCapacity(data);
    for (const r of data.rows) expect(md).toContain(`| ${r.machine} | ${r.batches} |`);
    const machines = [...new Set(data.rows.map((r) => r.machine))];
    for (const m of machines) expect(md).toMatch(new RegExp(`^- \\*\\*${m}:\\*\\* `, 'm'));
  });

  it('places the knee from the data: the first throttled level, or none', () => {
    const rows = data.rows.filter((r) => r.machine === data.rows[0]!.machine);
    const calm = rows.map((r) => ({ ...r, throttle_max: 0 }));
    expect(renderCapacity({ ...data, rows: calm })).toContain(
      `not throttled at any level, up to ${rows.at(-1)!.batches}`,
    );
    const hot = rows.map((r) => ({ ...r, throttle_max: r.batches >= 8 ? 50 : 0 }));
    expect(renderCapacity({ ...data, rows: hot })).toContain('throttled at 8 (not at 4)');
  });

  it('says the store does not hold the measured results when it would not', () => {
    const big = {
      ...data,
      worst_case: { ...data.worst_case, largest_result_bytes: 64 * 1024 * 1024 },
    };
    expect(renderCapacity(big)).toContain('does not hold');
    expect(renderCapacity(data)).toMatch(/which the store's \d+ MiB holds\./);
  });
});
