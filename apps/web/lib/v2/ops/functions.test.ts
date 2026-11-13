import { describe, expect, it, vi } from 'vitest';
import {
  FOUNDER_DIGEST_FN_ID,
  FOUNDER_ENTITLEMENT_FN_ID,
  FOUNDER_SWEEP_FN_ID,
} from '../../../../../inngest/founder';
import { SIGNIN_CANARY_FN_ID } from '../../../../../inngest/signin-canary';
import { opsFunctions } from './functions';

// stripe-account.ts imports 'server-only', which throws outside Next.
vi.mock('server-only', () => ({}));

const ids = (fns: readonly unknown[]) =>
  fns.flatMap((fn) =>
    (fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): { id: string }[] })
      .getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: 'crawlmouse' })
      .map((c) => c.id),
  );

const FOUNDER = [FOUNDER_ENTITLEMENT_FN_ID, FOUNDER_SWEEP_FN_ID, FOUNDER_DIGEST_FN_ID].map(
  (id) => `crawlmouse-${id}`,
);
const CANARY = `crawlmouse-${SIGNIN_CANARY_FN_ID}`;
const TO = ['canary', 'example.test'].join('@');
const signIn = async () => 'sent' as const;

describe('opsFunctions', () => {
  it('registers nothing unless V2_BILLING or V2_CHECKS_PUBLIC is 1', () => {
    for (const env of [{}, { V2_BILLING: '0' }, { V2_CHECKS_PUBLIC: 'true' }, { V2_PIPELINE: '1' }])
      expect(opsFunctions({ ...env, SIGNIN_CANARY_TO: TO }, signIn)).toEqual([]);
  });

  it('registers the founder functions with either flag', () => {
    expect(ids(opsFunctions({ V2_BILLING: '1' }))).toEqual(FOUNDER);
    expect(ids(opsFunctions({ V2_CHECKS_PUBLIC: '1' }))).toEqual(FOUNDER);
  });

  it('adds the canary only with a sign-in link and SIGNIN_CANARY_TO one plain address', () => {
    expect(ids(opsFunctions({ V2_BILLING: '1', SIGNIN_CANARY_TO: TO }, signIn))).toEqual([
      ...FOUNDER,
      CANARY,
    ]);
    expect(ids(opsFunctions({ V2_BILLING: '1', SIGNIN_CANARY_TO: ` ${TO} ` }, signIn))).toContain(
      CANARY,
    );
    for (const to of [undefined, '', '  ', 'not-an-address', `${TO}, other@example.test`])
      expect(ids(opsFunctions({ V2_BILLING: '1', SIGNIN_CANARY_TO: to }, signIn))).not.toContain(
        CANARY,
      );
    expect(ids(opsFunctions({ V2_BILLING: '1', SIGNIN_CANARY_TO: TO }))).not.toContain(CANARY);
  });
});
