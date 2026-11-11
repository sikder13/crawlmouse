import { describe, expect, it } from 'vitest';
import { accountEmail } from './emails';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const T1 = '00000000-0000-4000-8000-0000000000a1';
const T2 = '00000000-0000-4000-8000-0000000000a2';

describe('the account emails as email.requested', () => {
  it('names the account, the template and the link rows, and nothing else', () => {
    expect(accountEmail(ACCOUNT, 'account_delete', [T1, T2])).toEqual({
      id: `email.requested:account_delete:${ACCOUNT}:${T1},${T2}`,
      name: 'email.requested',
      data: { accountId: ACCOUNT, template: 'account_delete', tokenIds: [T1, T2] },
    });
  });

  it('gives two requests for the same account different ids', () => {
    expect(accountEmail(ACCOUNT, 'email_change_confirm', [T1]).id).not.toBe(
      accountEmail(ACCOUNT, 'email_change_confirm', [T2]).id,
    );
  });

  it('refuses an email with no link', () => {
    expect(() => accountEmail(ACCOUNT, 'email_change_notice', [])).toThrow(/no link/);
  });
});
