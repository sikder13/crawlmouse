/**
 * What the door is built with under each flag (CC-22b D1, D7): the claim's `keep` with
 * V2_CHECKS_PUBLIC, the first audit with V2_PIPELINE as well, and neither with V2_CHECKS_PUBLIC
 * unset, whatever V2_PIPELINE says.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
vi.mock('../supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

import { doorDeps } from './door-deps';

afterEach(() => {
  vi.unstubAllEnvs();
});

const FLAG_VALUES = [undefined, '', '0', 'true', '1', ' 1 '] as const;
const on = (v: string | undefined) => v?.trim() === '1';

describe('doorDeps', () => {
  for (const publicChecks of FLAG_VALUES)
    for (const pipeline of FLAG_VALUES) {
      it(`V2_CHECKS_PUBLIC=${JSON.stringify(publicChecks)}, V2_PIPELINE=${JSON.stringify(pipeline)}`, () => {
        vi.stubEnv('V2_CHECKS_PUBLIC', publicChecks);
        vi.stubEnv('V2_PIPELINE', pipeline);
        const { claim, firstLogin } = doorDeps();
        expect(claim.keep !== undefined).toBe(on(publicChecks));
        expect(claim.firstAudit !== undefined).toBe(on(publicChecks) && on(pipeline));
        expect(firstLogin.firstAudit).toBe(claim.firstAudit);
      });
    }
});
