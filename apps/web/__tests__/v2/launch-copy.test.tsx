/**
 * The two copy fixes of CC-39 D4: the delete step names what an email change holds it for (walk-
 * findings item 9), and the deletion link's page says "account" or "accounts" by the count it names
 * (item 13).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { DeletionScreen } from '../../components/v2/screens/deletion/DeletionScreen';
import { REFUSAL_SENTENCES } from '../../lib/v2/copy/settings-notices';
import { fixture } from '../../lib/v2/fixtures';
import { deleteStepView } from '../../lib/v2/view/settings';

describe('the delete step, held by an email change (F7)', () => {
  const v = deleteStepView(fixture('bad-site'), ACCOUNT_VIEWERS.home(), {
    blocked: 'email_change_pending',
  });

  it('names the confirmation link and the seven-day undo window, in one sentence', () => {
    expect(v.blocked).toBe(
      'The sign-in address is being changed, so the account cannot be deleted yet: deleting waits until the change’s confirmation link is used or expires and, once the change applies, for the seven days its undo link works.',
    );
    expect(v.submit).toBeNull();
  });

  it('the email form’s sentence for the same code is left as it was', () => {
    expect(REFUSAL_SENTENCES.email_change_pending).toBe(
      'An email change is waiting on its confirmation link. Confirm it or let it expire, then try again.',
    );
  });
});

describe('the deletion link’s page follows the count (F12)', () => {
  const account = (n: number) => ({ id: `a${n}`, host: `shop${n}.example`, subscription: null });
  const page = (n: number) =>
    renderToStaticMarkup(
      <DeletionScreen
        flow="deleteConfirm"
        view={{
          ok: true,
          purgeAfter: null,
          accounts: Array.from({ length: n }, (_, i) => account(i + 1)),
        }}
      />,
    );

  it('one account: singular throughout', () => {
    const html = page(1);
    expect(html).toContain('Pressing the button deletes this account and everything in it:');
    expect(html).toContain('After that the account, its sites, checks and reports');
    expect(html).toMatch(/>Delete this account</);
    expect(html).not.toMatch(/these accounts|the accounts, their/);
  });

  it('two accounts: plural throughout', () => {
    const html = page(2);
    expect(html).toContain('Pressing the button deletes these accounts and everything in them:');
    expect(html).toContain('After that the accounts, their sites, checks and reports');
    expect(html).toMatch(/>Delete these accounts</);
  });
});
