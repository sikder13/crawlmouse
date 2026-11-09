import { describe, expect, it } from 'vitest';
import { STEP_OUTPUT_BYTES } from './check';
import { inngest } from './client';
import { CHECK_REAPER_FN_ID, createCheckReaperFn, type ReapedCheck } from './check-reaper';

function fakeStep() {
  const ids: string[] = [];
  const outputs: unknown[] = [];
  return {
    ids,
    outputs,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ids.push(id);
        const out = await fn();
        outputs.push(out);
        return out;
      },
      sendEvent: async (id: string) => {
        ids.push(id);
      },
    },
  };
}

async function reapWith(reaped: ReapedCheck[]) {
  const sent: unknown[][] = [];
  const fn = createCheckReaperFn(
    async () => reaped,
    async (events) => void sent.push(events),
  ) as unknown as {
    fn: (ctx: unknown) => Promise<unknown>;
  };
  const fake = fakeStep();
  const out = await fn.fn({ step: fake.step });
  return { out, sent, ...fake };
}

describe('createCheckReaperFn (D13)', () => {
  it('runs every ten minutes, one run at a time', () => {
    const [config] = (
      createCheckReaperFn(async () => []) as unknown as {
        getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[];
      }
    ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id });
    expect(config).toMatchObject({
      id: `${inngest.id}-${CHECK_REAPER_FN_ID}`,
      triggers: [{ cron: '*/10 * * * *' }],
      concurrency: { limit: 1 },
    });
  });

  it('sends check.failed for each reaped check, with its reason, under its id, inside the reap step', async () => {
    const { sent, ids, out } = await reapWith([
      { checkId: 'c1', siteId: 's1', reason: 'stalled' },
      { checkId: 'c2', siteId: 's2', reason: 'not_started' },
    ]);
    expect(ids).toEqual(['reap']);
    expect(sent).toEqual([
      [
        {
          id: 'check-failed:c1',
          name: 'check.failed',
          data: { checkId: 'c1', siteId: 's1', reason: 'stalled' },
        },
        {
          id: 'check-failed:c2',
          name: 'check.failed',
          data: { checkId: 'c2', siteId: 's2', reason: 'not_started' },
        },
      ],
    ]);
    expect(out).toEqual({ stalled: 1, not_started: 1 });
  });

  it('sends nothing when nothing was reaped', async () => {
    const { sent, ids, out } = await reapWith([]);
    expect(ids).toEqual(['reap']);
    expect(sent).toEqual([]);
    expect(out).toEqual({ stalled: 0, not_started: 0 });
  });

  it('returns counts from the reap step, under the step output bound, however many it reaped (correctness 9)', async () => {
    const reaped: ReapedCheck[] = Array.from({ length: 5000 }, (_, i) => ({
      checkId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      siteId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
      reason: i % 2 === 0 ? 'stalled' : 'not_started',
    }));
    // The list itself is over the bound: the step must not return it.
    expect(Buffer.byteLength(JSON.stringify(reaped))).toBeGreaterThan(STEP_OUTPUT_BYTES);
    const { outputs, sent } = await reapWith(reaped);
    expect(outputs).toEqual([{ stalled: 2500, not_started: 2500 }]);
    expect(Buffer.byteLength(JSON.stringify(outputs[0]))).toBeLessThan(STEP_OUTPUT_BYTES);
    expect(sent.flat()).toHaveLength(5000);
  });
});
