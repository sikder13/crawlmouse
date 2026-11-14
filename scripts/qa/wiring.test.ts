import { describe, expect, it } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import { asker, wire, WiringError } from './wiring';

/**
 * The QA wiring's refusals that come before any network call (CC-38 D1(b)): `--billing` takes the
 * app's `stripeAccount`, whose production-database guard must see the Supabase URL the run writes
 * to, whichever variable named it. Nothing here reaches Supabase or Stripe: a client is constructed
 * only, and the refusals come before Stripe's.
 *   pnpm --filter @crawlmouse/scripts exec vitest run qa/wiring.test.ts
 */

const PROD = 'https://ezspnfeyzwsisymytssm.supabase.co';
const testKey = ['sk', 'test', 'qa'.repeat(12)].join('_');
const base = {
  QA_INBOX: 'qa@example.test',
  SUPABASE_SERVICE_ROLE_KEY: ['service', 'role', 'sample'].join('-'),
  STRIPE_ACCOUNT_SECRET_KEY: testKey,
};

// stripeAccount (apps/web/lib/billing/stripe-account.ts) keeps the first client it builds for the
// process, so a case that builds one successfully runs last in this describe: before the refusals, its
// cached client would turn them red even with correct code (never green with wrong code).
describe('qa wiring: --billing over the production database', () => {
  it('refuses a test key when only SUPABASE_URL names the production project', () => {
    const wired = wire({ ...base, SUPABASE_URL: PROD }, () => {});
    expect(() => wired.billing()).toThrow(WiringError);
    expect(() => wired.billing()).toThrow(/live mode only/);
  });

  it('refuses it when NEXT_PUBLIC_SUPABASE_URL names it, as the app does', () => {
    const wired = wire({ ...base, NEXT_PUBLIC_SUPABASE_URL: PROD }, () => {});
    expect(() => wired.billing()).toThrow(/live mode only/);
  });

  it('refuses it when SUPABASE_URL, which the run uses, is production and the other is not', () => {
    const env = { ...base, SUPABASE_URL: PROD, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' };
    expect(() => wire(env, () => {}).billing()).toThrow(/live mode only/);
  });

  it('builds the deps for a test key over another project', () => {
    const wired = wire({ ...base, SUPABASE_URL: 'http://127.0.0.1:54321' }, () => {});
    expect(wired.billing().keyLive).toBe(false);
  });
});

describe('qa wiring: the terminal question', () => {
  it('answers the empty string when the input ends unanswered (cron, CI, a pipe)', async () => {
    const answer = await asker(Readable.from([]), new PassThrough())('Type "x" to go on: ');
    expect(answer).toBe('');
  });

  it('answers what was typed', async () => {
    const answer = await asker(Readable.from(['open 4 live checkouts\n']), new PassThrough())('? ');
    expect(answer).toBe('open 4 live checkouts');
  });
});
