import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// CRAWL_PAUSED=1 must short-circuit the audit function at entry: mark the audit failed('paused') and
// return before mark-crawling, the crawl, or the completed event. The engine is mocked so a crawl that
// slipped through would be observable (runAuditMock called), and supabaseAdmin throws so the handler can
// only use the client the test injects.
const runAuditMock = vi.fn();
vi.mock('@crawlmouse/engine', () => ({ runAudit: (...a: unknown[]) => runAuditMock(...a) }));
vi.mock('./supabase', () => ({
  supabaseAdmin: () => {
    throw new Error('supabaseAdmin() must not be called: the test injects the client');
  },
}));
const notifyMock = vi.fn(async () => {});
vi.mock('./notify', () => ({
  sendAuditNotification: (...a: unknown[]) => notifyMock(...(a as [])),
}));

import { applyCrawlPause, auditHandler, isCrawlPaused, setAuditFailureReporter } from './audit';

type Sb = Parameters<typeof applyCrawlPause>[0];

/** Records every write chain the handler issues against `audits`. */
function fakeSb(opts: { pauseUpdateError?: { message: string } } = {}) {
  const writes: Array<{
    patch: Record<string, unknown>;
    filters: Array<[string, string, unknown]>;
  }> = [];
  const from = vi.fn((table: string) => {
    expect(table).toBe('audits');
    return {
      update: (patch: Record<string, unknown>) => {
        const w = { patch, filters: [] as Array<[string, string, unknown]> };
        writes.push(w);
        const chain = {
          eq: (col: string, val: unknown) => {
            w.filters.push(['eq', col, val]);
            return chain;
          },
          in: (col: string, val: unknown) => {
            w.filters.push(['in', col, val]);
            return Promise.resolve({ data: null, error: opts.pauseUpdateError ?? null });
          },
          then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
        };
        return chain;
      },
    };
  });
  return { sb: { from } as unknown as Sb, writes };
}

/** A fake Inngest `step` that records step ids in order and runs each step body inline. */
function fakeStep(canned: Record<string, unknown> = {}) {
  const ran: string[] = [];
  const step = {
    run: vi.fn(async (id: string, fn: () => unknown) => {
      ran.push(id);
      return id in canned ? canned[id] : fn();
    }),
    sendEvent: vi.fn(async (id: string) => {
      ran.push(id);
      return { ids: [] };
    }),
  };
  return { step, ran };
}

const event = {
  name: 'audit.requested' as const,
  data: { auditId: 'aud-1', url: 'https://example.com' },
};
type HandlerCtx = Parameters<typeof auditHandler>[0];
const ctx = (step: unknown) => ({ event, step }) as unknown as HandlerCtx;

beforeEach(() => {
  delete process.env.CRAWL_PAUSED;
  runAuditMock.mockReset();
  notifyMock.mockClear();
});
afterEach(() => {
  delete process.env.CRAWL_PAUSED;
  setAuditFailureReporter(() => {});
});

describe('isCrawlPaused (worker side)', () => {
  it('is paused only for the value 1 (surrounding whitespace ignored)', () => {
    expect(isCrawlPaused({ CRAWL_PAUSED: '1' })).toBe(true);
    expect(isCrawlPaused({ CRAWL_PAUSED: '1\n' })).toBe(true);
    for (const v of [undefined, '', '0', 'true', '11'])
      expect(isCrawlPaused({ CRAWL_PAUSED: v })).toBe(false);
  });
});

describe('applyCrawlPause', () => {
  it('returns false and writes nothing when not paused', async () => {
    const { sb, writes } = fakeSb();
    await expect(applyCrawlPause(sb, 'aud-1', {})).resolves.toBe(false);
    expect(writes).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('marks a pending/crawling audit failed with reason "paused" and notifies', async () => {
    const { sb, writes } = fakeSb();
    await expect(applyCrawlPause(sb, 'aud-1', { CRAWL_PAUSED: '1' })).resolves.toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.patch).toMatchObject({ status: 'failed', failure_reason: 'paused' });
    expect(typeof writes[0]!.patch.completed_at).toBe('string');
    // Conditional like every other status writer: never clobbers a canceled/completed row.
    expect(writes[0]!.filters).toEqual([
      ['eq', 'id', 'aud-1'],
      ['in', 'status', ['pending', 'crawling']],
    ]);
    expect(notifyMock).toHaveBeenCalledWith(sb, 'aud-1');
  });

  it('throws on a DB error so the step retries and onFailure takes over (the audit is never left pending)', async () => {
    const { sb } = fakeSb({ pauseUpdateError: { message: 'db down' } });
    await expect(applyCrawlPause(sb, 'aud-1', { CRAWL_PAUSED: '1' })).rejects.toThrow(/db down/);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('a throwing notifier does not undo the pause (best-effort, like handleAuditFailure)', async () => {
    const { sb } = fakeSb();
    notifyMock.mockRejectedValueOnce(new Error('smtp down'));
    await expect(applyCrawlPause(sb, 'aud-1', { CRAWL_PAUSED: '1' })).resolves.toBe(true);
  });
});

describe('auditHandler — CRAWL_PAUSED short-circuit', () => {
  it('CRAWL_PAUSED=1: runs only the pause-gate step, never crawls, never emits completed', async () => {
    process.env.CRAWL_PAUSED = '1';
    const reporter = vi.fn();
    setAuditFailureReporter(reporter);
    const { sb, writes } = fakeSb();
    const { step, ran } = fakeStep();

    const out = await auditHandler(ctx(step), sb);

    expect(out).toEqual({ auditId: 'aud-1', paused: true });
    expect(ran).toEqual(['pause-gate']);
    expect(runAuditMock).not.toHaveBeenCalled();
    expect(step.sendEvent).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.patch).toMatchObject({ status: 'failed', failure_reason: 'paused' });
    // A deliberate pause is not an incident: the audit-failed alert must not fire.
    expect(reporter).not.toHaveBeenCalled();
  });

  it('not paused: pause-gate runs first, then the normal mark-crawling → crawl → completed sequence', async () => {
    const summary = { auditId: 'aud-1', grade: 'B', score: 80 };
    const { sb } = fakeSb();
    const { step, ran } = fakeStep({ 'crawl-and-persist': summary });

    const out = await auditHandler(ctx(step), sb);

    expect(out).toEqual(summary);
    expect(ran).toEqual([
      'pause-gate',
      'mark-crawling',
      'crawl-and-persist',
      'emit-completed',
      'send-notify-email',
    ]);
  });
});

describe('auditFn wiring', () => {
  it('the registered Inngest function delegates to auditHandler (so the tested handler is the one that runs)', () => {
    const code = readFileSync(new URL('./audit.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).toMatch(
      /\{\s*event:\s*['"]audit\.requested['"]\s*\}\s*,\s*\(\s*\{\s*event\s*,\s*step\s*\}\s*\)\s*=>\s*auditHandler\(\s*\{\s*event\s*,\s*step\s*\}\s*\)/,
    );
  });
});
