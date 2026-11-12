/**
 * The sign-in sender is one constant (owner ruling CC-28 Q5, docs/ops/senders.md): the copy registry's
 * corrections of the locked `signin@` read SIGNIN_SENDER, and once the owner moves Supabase's sender
 * and the constant with it, there is nothing left to correct. Checked by loading the copy modules
 * with the constant at each value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../../auth/constants');
  vi.resetModules();
});

async function rowsWith(sender: string | null) {
  vi.resetModules();
  if (sender !== null) {
    vi.doMock('../../auth/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../auth/constants')>()),
      SIGNIN_SENDER: sender,
    }));
  }
  const { SIGNIN_SENDER_LOCKED } = await import('../../auth/constants');
  const { ACCOUNT_DOOR_CHANGES } = await import('./account-door');
  const { SETTINGS_CHANGES } = await import('./settings');
  return [...ACCOUNT_DOOR_CHANGES, ...SETTINGS_CHANGES]
    .filter((c) => c.locked === SIGNIN_SENDER_LOCKED)
    .map((c) => [c.screen, c.rendered]);
}

describe('the sign-in sender’s corrections', () => {
  it('today: each screen that names the locked signin@ renders SIGNIN_SENDER', async () => {
    const { SIGNIN_SENDER } = await import('../../auth/constants');
    expect(await rowsWith(null)).toEqual([
      ['check-email', SIGNIN_SENDER],
      ['check-email-no-audit', SIGNIN_SENDER],
      ['settings', SIGNIN_SENDER],
    ]);
  });

  it('read from the constant: another sender is the one rendered', async () => {
    expect((await rowsWith('other@crawlmouse.com')).map(([, r]) => r)).toEqual([
      'other@crawlmouse.com',
      'other@crawlmouse.com',
      'other@crawlmouse.com',
    ]);
  });

  it('after the switch (the constant is the locked address): no correction is left', async () => {
    expect(await rowsWith('signin@crawlmouse.com')).toEqual([]);
  });
});
