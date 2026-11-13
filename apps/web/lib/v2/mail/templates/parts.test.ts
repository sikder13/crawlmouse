import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_NAME_MAX, accountNameText } from './parts';
import { reportConfirm } from './report-confirm';
import { seatInvite } from './seat-invite';

const TOKEN = 'A'.repeat(43);

// An account's name is text its owner typed, mailed to an address its owner chose. A message shows
// it as a name, and not at all when a mail client would turn part of it into a link.
describe('accountNameText', () => {
  it.each(['Summit Digital', 'St. Mary & Sons', 'Studio 2.5', 'Agence Étoile', 'A/B Partners'])(
    'keeps a name that holds nothing a mail client links: %s',
    (name) => {
      expect(accountNameText(name)).toBe(name);
    },
  );

  it.each([
    'Your site is down. Restore it at https://evil.example/login',
    'see www.evil.example',
    'WWW.EVIL.EXAMPLE',
    'evil.example/login',
    'write to help@evil.example',
    'Acme.io',
    'ftp://files',
  ])('shows no name for one a mail client would link: %s', (name) => {
    expect(accountNameText(name)).toBeNull();
  });

  it('has no name for null, an empty one and spaces, and bounds a long one', () => {
    expect([accountNameText(null), accountNameText(''), accountNameText('  ')]).toEqual([
      null,
      null,
      null,
    ]);
    expect(accountNameText('n'.repeat(500))!.length).toBeLessThanOrEqual(ACCOUNT_NAME_MAX);
  });

  it('property: whatever is typed around it, a name that holds a URL, a www. host or an address is not shown', () => {
    const linked = fc.constantFrom('https://evil.example', 'www.evil.example', 'a@evil.example');
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), linked, fc.string({ maxLength: 20 }), (a, l, b) => {
        const name = `${a} ${l} ${b}`;
        // Bounded to its first characters: the link is cut or whole, and whole it is refused.
        const shown = accountNameText(name);
        return shown === null || !shown.includes(l);
      }),
    );
  });
});

describe('a name a mail client would link, in the mails that show the name', () => {
  const HOSTILE = 'Your site is down. Restore it at https://evil.example/login';

  it('the confirmation is the mail of an account with no name', () => {
    const named = reportConfirm({ token: TOKEN, agencyName: HOSTILE, host: 'example.com' });
    const bare = reportConfirm({ token: TOKEN, agencyName: null, host: 'example.com' });
    expect(named).toEqual(bare);
    expect(named.text).not.toContain('evil.example');
  });

  it('the invitation is the mail of an account with no name', () => {
    const named = seatInvite({ token: TOKEN, accountName: HOSTILE, role: 'developer' });
    const bare = seatInvite({ token: TOKEN, accountName: null, role: 'developer' });
    expect(named).toEqual(bare);
    expect(named.text).not.toContain('evil.example');
  });
});
