import { describe, expect, it, vi } from 'vitest';
import { supabaseRenderBudget } from './render-budget';

const CHECK = '00000000-0000-4000-8000-000000000001';
const R1 = '00000000-0000-4000-8000-0000000000a1';
const R2 = '00000000-0000-4000-8000-0000000000a2';

/** A client whose reserve answers come from `granted`, in order. */
const client = (
  granted: (string | null)[] = [R1, R2],
  error: { message: string } | null = null,
) => {
  const left = [...granted];
  const rpc = vi.fn(async (name: string) => ({
    data: name === 'reserve_render_ms' ? (left.shift() ?? null) : null,
    error,
  }));
  return { rpc, sb: { rpc } as never };
};

describe('the daily render budget, per check', () => {
  it('settles each phase against the reservation that phase was given', async () => {
    const { rpc, sb } = client();
    const budget = supabaseRenderBudget(sb, CHECK);
    expect(await budget.reserve(600, 1000)).toBe(true);
    await budget.settle(600, 250);
    expect(await budget.reserve(300, 1000)).toBe(true);
    await budget.settle(300, 10);
    expect(rpc.mock.calls).toEqual([
      ['reserve_render_ms', { p_check: CHECK, p_ms: 600, p_limit_ms: 1000 }],
      ['settle_render_ms', { p_reservation: R1, p_used_ms: 250 }],
      ['reserve_render_ms', { p_check: CHECK, p_ms: 300, p_limit_ms: 1000 }],
      ['settle_render_ms', { p_reservation: R2, p_used_ms: 10 }],
    ]);
  });

  it('sends whole milliseconds, rounding time used up so a cap is not undercounted', async () => {
    const { rpc, sb } = client();
    const budget = supabaseRenderBudget(sb, CHECK);
    await budget.reserve(600.2, 1000.9);
    await budget.settle(601, 12.1);
    expect(rpc.mock.calls[0]![1 as never]).toMatchObject({ p_ms: 601, p_limit_ms: 1000 });
    expect(rpc.mock.calls[1]![1 as never]).toMatchObject({ p_used_ms: 13 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'does not settle a time used of %s, so the reservation stays counted',
    async (used) => {
      const { rpc, sb } = client();
      const budget = supabaseRenderBudget(sb, CHECK);
      expect(await budget.reserve(600, 5000)).toBe(true);
      await budget.settle(600, used);
      expect(rpc.mock.calls.map(([name]) => name)).toEqual(['reserve_render_ms']);
    },
  );

  it('is refused when the database gives no reservation, and then settles nothing', async () => {
    const { rpc, sb } = client([null]);
    const budget = supabaseRenderBudget(sb, CHECK);
    expect(await budget.reserve(1, 2)).toBe(false);
    await budget.settle(1, 1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not settle an earlier reservation after a later one was refused', async () => {
    const { rpc, sb } = client([R1, null]);
    const budget = supabaseRenderBudget(sb, CHECK);
    expect(await budget.reserve(1, 2)).toBe(true);
    expect(await budget.reserve(1, 2)).toBe(false);
    await budget.settle(1, 1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('throws on a database error, which the engine records as no budget', async () => {
    const reserving = supabaseRenderBudget(client([], { message: 'down' }).sb, CHECK);
    await expect(reserving.reserve(1, 2)).rejects.toThrow(/render budget/);
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: R1, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    const settling = supabaseRenderBudget({ rpc } as never, CHECK);
    await settling.reserve(1, 2);
    await expect(settling.settle(1, 1)).rejects.toThrow(/render budget/);
  });
});
