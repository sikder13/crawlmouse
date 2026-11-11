/**
 * What the door is built with under each flag (CC-22b D1, D7): the claim's `keep` with
 * V2_CHECKS_PUBLIC, the first audit with V2_PIPELINE as well, and neither with V2_CHECKS_PUBLIC
 * unset, whatever V2_PIPELINE says. `doorDeps` runs here with the service-role client, Sentry,
 * Inngest and the stores' factories replaced at the module boundary, so each assertion is on what
 * `doorDeps` itself hands to `claimKeep` and `firstAuditRequester`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ADMIN: { client: 'service-role' },
  captureMessage: vi.fn(),
  send: vi.fn(async (_event: unknown) => ({ ids: ['evt'] })),
  hasLiveOrGradedCheck: vi.fn(async (_siteId: string) => true),
  claimKeep: vi.fn((deps: unknown) => ({ built: 'keep', deps })),
  firstAuditRequester: vi.fn((deps: unknown) => ({ built: 'first-audit', deps })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: mocks.captureMessage }));
vi.mock('../supabase/admin', () => ({ supabaseAdmin: () => mocks.ADMIN }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mocks.ADMIN }));
vi.mock('../inngest', () => ({ inngest: { send: mocks.send } }));
vi.mock('../v2/pipeline/keep-store', () => ({
  supabaseKeepStore: (sb: unknown) => ({
    store: 'keep',
    sb,
    hasLiveOrGradedCheck: mocks.hasLiveOrGradedCheck,
  }),
}));
vi.mock('../v2/pipeline/evidence', () => ({
  supabaseEvidenceStore: (sb: unknown) => ({ store: 'evidence', sb }),
}));
vi.mock('../v2/pipeline/store', () => ({
  supabasePipelineStore: (sb: unknown) => ({ store: 'pipeline', sb }),
}));
vi.mock('../v2/pipeline/keep', () => ({ claimKeep: mocks.claimKeep }));
vi.mock('../v2/pipeline/first-audit', () => ({
  firstAuditRequester: mocks.firstAuditRequester,
}));

import { startLimits } from '../../app/api/checks/_lib/start-limits';
import type { FirstAuditDeps } from '../v2/pipeline/first-audit';
import type { KeepDeps } from '../v2/pipeline/keep';
import { doorDeps } from './door-deps';

const { ADMIN, captureMessage, send, hasLiveOrGradedCheck, claimKeep, firstAuditRequester } = mocks;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const FLAG_VALUES = [undefined, '', '0', 'true', '1', ' 1 '] as const;
const on = (v: string | undefined) => v?.trim() === '1';

function build(publicChecks: string | undefined, pipeline: string | undefined) {
  vi.stubEnv('V2_CHECKS_PUBLIC', publicChecks);
  vi.stubEnv('V2_PIPELINE', pipeline);
  return doorDeps();
}

describe('doorDeps', () => {
  for (const publicChecks of FLAG_VALUES)
    for (const pipeline of FLAG_VALUES) {
      it(`V2_CHECKS_PUBLIC=${JSON.stringify(publicChecks)}, V2_PIPELINE=${JSON.stringify(pipeline)}`, () => {
        const { claim, firstLogin } = build(publicChecks, pipeline);
        const keep = on(publicChecks);
        const firstAudit = on(publicChecks) && on(pipeline);
        expect(claimKeep).toHaveBeenCalledTimes(keep ? 1 : 0);
        expect(claim.keep).toBe(keep ? claimKeep.mock.results[0]!.value : undefined);
        expect(firstAuditRequester).toHaveBeenCalledTimes(firstAudit ? 1 : 0);
        expect(claim.firstAudit).toBe(
          firstAudit ? firstAuditRequester.mock.results[0]!.value : undefined,
        );
        expect(firstLogin.firstAudit).toBe(claim.firstAudit);
      });
    }

  it('the claim’s keep is built on the service-role client’s stores and reports to Sentry', () => {
    build('1', undefined);
    const deps = claimKeep.mock.calls[0]![0] as KeepDeps;
    expect(deps.store).toMatchObject({ store: 'keep', sb: ADMIN });
    expect(deps.evidence).toEqual({ store: 'evidence', sb: ADMIN });
    expect(deps.budgetMs).toBeUndefined();
    deps.report('keep-evidence-not-moved', { checkId: 'c1' });
    expect(captureMessage.mock.calls).toEqual([
      [
        'auth.keep-evidence-not-moved',
        { level: 'warning', tags: { signal: 'keep-evidence-not-moved' }, extra: { checkId: 'c1' } },
      ],
    ]);
  });

  it('first audits take the start route’s limits, the pause switch, the keep store’s read and the pipeline’s request', async () => {
    build('1', '1');
    const deps = firstAuditRequester.mock.calls[0]![0] as FirstAuditDeps;
    expect(deps.limits).toBe(startLimits);

    vi.stubEnv('CRAWL_PAUSED', '1');
    expect(deps.paused()).toBe(true);
    vi.stubEnv('CRAWL_PAUSED', '0');
    expect(deps.paused()).toBe(false);

    expect(await deps.hasLiveOrGradedCheck('site-1')).toBe(true);
    hasLiveOrGradedCheck.mockResolvedValueOnce(false);
    expect(await deps.hasLiveOrGradedCheck('site-2')).toBe(false);
    expect(hasLiveOrGradedCheck.mock.calls).toEqual([['site-1'], ['site-2']]);

    expect(deps.request.store).toEqual({ store: 'pipeline', sb: ADMIN });
    expect(deps.request.now).toBe(Date.now);
    const event = { name: 'check.requested', data: { checkId: 'c1' } };
    await deps.request.send(event as never);
    expect(send.mock.calls).toEqual([[event]]);
    expect('newId' in deps.request).toBe(false);
  });
});
