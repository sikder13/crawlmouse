import { describe, expect, it, vi } from 'vitest';
import { supabaseRenderBudget } from './render-budget';

const CHECK = '00000000-0000-4000-8000-000000000001';

const client = (answer: { data?: unknown; error?: { message: string } | null }) => {
  const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null }));
  return { rpc, sb: { rpc } as never };
};

describe('the daily render budget, per check', () => {
  it('numbers the phases in the order they reserve, and settles the one it holds', async () => {
    const { rpc, sb } = client({ data: true });
    const budget = supabaseRenderBudget(sb, CHECK);
    expect(await budget.reserve(600, 1000)).toBe(true);
    await budget.settle(600, 250);
    expect(await budget.reserve(300, 1000)).toBe(true);
    await budget.settle(300, 10);
    expect(rpc.mock.calls).toEqual([
      ['reserve_render_ms', { p_check: CHECK, p_phase: 1, p_ms: 600, p_limit_ms: 1000 }],
      ['settle_render_ms', { p_check: CHECK, p_phase: 1, p_used_ms: 250 }],
      ['reserve_render_ms', { p_check: CHECK, p_phase: 2, p_ms: 300, p_limit_ms: 1000 }],
      ['settle_render_ms', { p_check: CHECK, p_phase: 2, p_used_ms: 10 }],
    ]);
  });

  it('numbers a retried step’s phases the same, so it finds its reservations', async () => {
    const { rpc, sb } = client({ data: true });
    await supabaseRenderBudget(sb, CHECK).reserve(600, 1000);
    await supabaseRenderBudget(sb, CHECK).reserve(600, 1000);
    const phases = rpc.mock.calls.map(
      (c) => (c as unknown as [string, { p_phase: number }])[1].p_phase,
    );
    expect(phases).toEqual([1, 1]);
  });

  it('sends whole milliseconds, rounding time used up so a cap is not undercounted', async () => {
    const { rpc, sb } = client({ data: true });
    const budget = supabaseRenderBudget(sb, CHECK);
    await budget.reserve(600.2, 1000.9);
    await budget.settle(601, 12.1);
    expect(rpc.mock.calls[0]![1 as never]).toMatchObject({ p_ms: 601, p_limit_ms: 1000 });
    expect(rpc.mock.calls[1]![1 as never]).toMatchObject({ p_used_ms: 13 });
  });

  it('grants only on a true answer', async () => {
    expect(await supabaseRenderBudget(client({ data: false }).sb, CHECK).reserve(1, 2)).toBe(false);
    expect(await supabaseRenderBudget(client({ data: 'true' }).sb, CHECK).reserve(1, 2)).toBe(
      false,
    );
  });

  it('throws on a database error, which the engine records as no budget', async () => {
    const { sb } = client({ error: { message: 'down' } });
    const budget = supabaseRenderBudget(sb, CHECK);
    await expect(budget.reserve(1, 2)).rejects.toThrow(/render budget/);
    await expect(budget.settle(1, 1)).rejects.toThrow(/render budget/);
  });
});
