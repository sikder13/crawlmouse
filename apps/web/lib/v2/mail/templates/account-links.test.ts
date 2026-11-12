import { describe, expect, it } from 'vitest';
import type { RenderedMail } from '../types';
import { accountDelete, emailChangeConfirm, emailChangeNotice } from './account-links';
import { foreignTargets, htmlTargets, textUrls } from './inspect';

const T1 = 'A'.repeat(43);
const T2 = 'b_-'.repeat(14) + 'c';

const targetsBoth = (m: RenderedMail) => ({ html: htmlTargets(m.html), text: textUrls(m.text) });

describe('the account-link emails (D2; links from issue_account_link)', () => {
  it('email-change confirm links the confirmation route with its token, once, in both parts', () => {
    const m = emailChangeConfirm({ token: T1 });
    expect(m.subject).toBe('Confirm your new Crawlmouse sign-in address');
    expect(targetsBoth(m)).toEqual({
      html: [`https://crawlmouse.com/account/email/${T1}`],
      text: [`https://crawlmouse.com/account/email/${T1}`],
    });
    expect(m.text).toContain('60 minutes');
  });

  it('the old-address notice links the undo route and says how long it can undo', () => {
    const m = emailChangeNotice({ token: T2 });
    expect(m.subject).toBe('Your Crawlmouse sign-in address is being changed');
    expect(targetsBoth(m)).toEqual({
      html: [`https://crawlmouse.com/account/email-undo/${T2}`],
      text: [`https://crawlmouse.com/account/email-undo/${T2}`],
    });
    expect(m.text).toContain('7 days');
  });

  it('the deletion email carries the confirmation link and its restore link, in that order', () => {
    const m = accountDelete({ confirmToken: T1, restoreToken: T2 });
    expect(m.subject).toBe('Confirm deleting your Crawlmouse account');
    expect(targetsBoth(m)).toEqual({
      html: [
        `https://crawlmouse.com/account/delete/${T1}`,
        `https://crawlmouse.com/account/restore/${T2}`,
      ],
      text: [
        `https://crawlmouse.com/account/delete/${T1}`,
        `https://crawlmouse.com/account/restore/${T2}`,
      ],
    });
    expect(m.text).toContain('7 days');
  });

  it('refuses a token that is not a token, rather than putting it in a link', () => {
    for (const bad of ['', 'x', `${T1}"><script>`, `${T1}/../x`, T1 + 'A']) {
      expect(() => emailChangeConfirm({ token: bad })).toThrow(RangeError);
      expect(() => emailChangeNotice({ token: bad })).toThrow(RangeError);
      expect(() => accountDelete({ confirmToken: T1, restoreToken: bad })).toThrow(RangeError);
    }
  });

  it('carries no unsubscribe link (account mail, D7) and no foreign target', () => {
    for (const m of [
      emailChangeConfirm({ token: T1 }),
      emailChangeNotice({ token: T1 }),
      accountDelete({ confirmToken: T1, restoreToken: T2 }),
    ]) {
      expect(m.html).not.toMatch(/unsubscribe/i);
      expect(foreignTargets(m)).toEqual([]);
      expect(m.subject).not.toMatch(/[\r\n]/);
    }
  });
});
