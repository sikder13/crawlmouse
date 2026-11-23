/**
 * F-108 on the rail and on Trial ending: while paid plans are not open, no account page offers the
 * checkout, which answers raw JSON with billing off, or says a plan can be chosen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { viewAt } from './account';
import { accountShellView, checkoutOpen } from './account-shell';
import { trialEndView, trialEndViewer, trialPage } from './trial-end';

const BAD = 'a0000000-0000-4000-8000-000000000001';
const bad = fixture('bad-site');
const CHECKOUT = '/api/billing/checkout';

/** The bad site's account, a day after its trial ended and moved to Free. */
function ended() {
  const d = {
    ...bad,
    accounts: bad.accounts.map((a) =>
      a.id === BAD
        ? {
            ...a,
            state: 'free' as const,
            trial_ends_at: null,
            state_history: [
              ...a.state_history,
              { state: 'free' as const, since: '2026-11-08T02:41:00.000Z' },
            ],
          }
        : a,
    ),
  };
  return { d, viewer: { accountId: BAD, now: '2026-11-09T15:00:00.000Z' } };
}

afterEach(() => vi.unstubAllEnvs());

describe('checkoutOpen', () => {
  it.each([
    [undefined, undefined, true],
    [undefined, '1', true],
    ['1', '1', true],
    ['1', undefined, false],
    ['1', '0', false],
  ])('V2_CHECKS_PUBLIC=%s, V2_BILLING=%s: %s', (checks, billing, open) => {
    expect(checkoutOpen({ V2_CHECKS_PUBLIC: checks, V2_BILLING: billing })).toBe(open);
  });
});

describe('the rail with paid plans closed', () => {
  const shell = (billingOpen?: boolean) =>
    accountShellView(viewAt(bad, ACCOUNT_VIEWERS.home()), 'Sites', {
      role: 'owner',
      ...(billingOpen === undefined ? {} : { billingOpen }),
    });

  it('offers no Keep and does not say a plan can be chosen', () => {
    const t = shell(false).trial!;
    expect(t.keep).toBeNull();
    expect(t.note).toBe(
      'Then Free: example-outfitter.com keeps monthly checks; the other three sites pause. Nothing you can see is deleted.',
    );
  });

  it('keeps Keep and its sentence with plans open', () => {
    const t = shell(true).trial!;
    expect(t.keep?.label).toBe('Keep Pro, $19 a month');
    expect(t.note).toContain('until you choose Pro or remove them');
  });

  it('reads the deployment when the page passes nothing', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('V2_BILLING', '');
    expect(shell().trial!.keep).toBeNull();
    vi.stubEnv('V2_BILLING', '1');
    expect(shell().trial!.keep).not.toBeNull();
  });
});

describe('Trial ending with paid plans closed', () => {
  const closed = () => trialEndView(bad, trialEndViewer(bad, BAD), { billingOpen: false });

  it('offers no checkout and no choice to let it end', () => {
    const v = closed();
    expect(v.banner.keep).toBeNull();
    expect(v.banner.end).toBeNull();
    expect(JSON.stringify(v)).not.toContain(CHECKOUT);
    expect(JSON.stringify(v)).not.toMatch(/choose pro|add pro|keep pro/i);
  });

  it('says what happens, with no price and no plan to pick', () => {
    const v = closed();
    expect(v.keepTitle).toBe('Paid plans');
    expect(v.keepText).toBe('Paid plans open shortly. Your trial runs to Sat 7 Nov.');
    expect(v.endTitle).toBe('When it ends');
    expect(v.endText).toBe(
      'Nothing to do. On Sat 7 Nov the account is Free: example-outfitter.com keeps its monthly check and its three fixes. The other three sites pause with their history kept, and so does the staging copy.',
    );
  });

  it('is unchanged with plans open', () => {
    const v = trialEndView(bad, trialEndViewer(bad, BAD), { billingOpen: true });
    expect(v.banner.keep?.label).toBe('Keep Pro, $19 a month · add a card');
    expect(v.banner.end?.label).toBe('Let it end on Sat 7 Nov');
    expect(v.keepTitle).toBe('If you keep Pro');
    expect(v.endTitle).toBe('If you let it end');
    expect(v.endText).toContain('add Pro any time to resume them');
  });

  it('reads the deployment when the page passes nothing', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('V2_BILLING', '');
    const shown = trialPage(bad, trialEndViewer(bad, BAD));
    expect(shown?.kind).toBe('before');
    expect(JSON.stringify(shown)).not.toContain(CHECKOUT);
  });
});

describe('Trial ended with paid plans closed', () => {
  it('offers no checkout and promises none', () => {
    const { d, viewer } = ended();
    const shown = trialPage(d, viewer, { billingOpen: false });
    expect(shown?.kind).toBe('after');
    if (shown?.kind !== 'after') throw new Error('unreachable');
    expect(shown.view.banner.keep).toBeNull();
    expect(shown.view.banner.sub).toBe('Nothing you can see was deleted. Paid plans open shortly.');
    expect(JSON.stringify(shown)).not.toContain(CHECKOUT);
  });

  it('keeps Choose with plans open', () => {
    const { d, viewer } = ended();
    const shown = trialPage(d, viewer, { billingOpen: true });
    if (shown?.kind !== 'after') throw new Error('unreachable');
    expect(shown.view.banner.keep?.label).toBe('Choose Pro, $19 a month');
    expect(shown.view.banner.sub).toContain('Choose Pro any time');
  });
});
