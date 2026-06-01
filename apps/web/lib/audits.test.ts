import { describe, it, expect } from 'vitest';
import { listMyAudits } from './audits';

function fakeSb(rows: unknown[] | null, error: { message: string } | null = null) {
  const calls: { or?: string } = {};
  const builder = {
    from() { return this; },
    select() { return this; },
    or(expr: string) { calls.or = expr; return this; },
    order() { return this; },
    limit() { return Promise.resolve({ data: rows, error }); },
  };
  return { builder, calls };
}

describe('listMyAudits', () => {
  it('coerces the numeric score string to a real number', async () => {
    const { builder } = fakeSb([{ id: '1', url: 'https://x.com', grade: 'A', score: '88.00', status: 'completed', started_at: 't', completed_at: 't' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await listMyAudits(builder as any);
    expect(out[0]!.score).toBe(88);
  });

  it('filters out expired audits via an expires_at predicate', async () => {
    const { builder, calls } = fakeSb([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await listMyAudits(builder as any);
    expect(calls.or).toContain('expires_at.is.null');
    expect(calls.or).toContain('expires_at.gt.');
  });

  it('returns an empty array when there are no audits', async () => {
    const { builder } = fakeSb(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await listMyAudits(builder as any)).toEqual([]);
  });
});
