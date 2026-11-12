import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INVITE_LINK_DAYS } from '../../agency/seats';
import { buildOutgoing } from '../headers';
import { foreignTargets, htmlTargets, textUrls } from './inspect';
import { seatInvite } from './seat-invite';

const TOKEN = 'T'.repeat(43);
const LINK = `https://crawlmouse.com/invite/${TOKEN}`;
const HOSTILE = '<script>x</script>"\'&\r\nBcc: victim@example.com https://evil.example/';

describe('seat-invite (CC-31 D3)', () => {
  it('says which account invites the reader and as what, and links the invitation alone', () => {
    const m = seatInvite({ token: TOKEN, accountName: 'Summit Digital', role: 'account_manager' });
    expect(m.subject).toBe('You are invited to Summit Digital on Crawlmouse');
    expect(m.text).toContain(
      'You are invited to Summit Digital on Crawlmouse. As an account manager you see audits and packets, run checks, and edit and send client reports.',
    );
    expect(htmlTargets(m.html)).toEqual([LINK]);
    expect(textUrls(m.text)).toEqual([LINK]);
  });

  it('words the role for a developer', () => {
    const m = seatInvite({ token: TOKEN, accountName: 'Summit Digital', role: 'developer' });
    expect(m.text).toContain(
      'As a developer you see audits and packets, mark fixes done and run checks.',
    );
    expect(m.text).not.toContain('account manager');
  });

  it.each([null, '', '   ', '\r\n\t'])(
    'names no account when it has no name (%j)',
    (accountName) => {
      const m = seatInvite({ token: TOKEN, accountName, role: 'developer' });
      expect(m.subject).toBe('You are invited to an account on Crawlmouse');
      expect(m.text).toContain('You are invited to an account on Crawlmouse. As a developer');
    },
  );

  it('says how long the link works, by the constant SQL’s interval is held to, and what ignoring it does', () => {
    const m = seatInvite({ token: TOKEN, accountName: null, role: 'developer' });
    expect(INVITE_LINK_DAYS).toBe(7);
    for (const part of [m.text, m.html]) {
      expect(part).toContain(`The link works for ${INVITE_LINK_DAYS} days.`);
      expect(part).toContain('you join the account only when you accept on that page');
    }
    // issue_seat_invite stores the expiry and returns it: both are p_now + this interval.
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../../../../infra/supabase/migrations/20261114000002_v2_031_agency.sql',
      ),
      'utf8',
    );
    const issue = /create or replace function public\.issue_seat_invite[\s\S]*?\n\$\$;/.exec(
      sql,
    )![0];
    expect([...issue.matchAll(/p_now \+ interval '([^']+)'/g)].map((m) => m[1])).toEqual([
      `${INVITE_LINK_DAYS} days`,
      `${INVITE_LINK_DAYS} days`,
    ]);
  });

  it('escapes, bounds and folds the account’s name, and never links it', () => {
    const m = seatInvite({ token: TOKEN, accountName: HOSTILE.repeat(20), role: 'developer' });
    expect(m.html).not.toContain('<script>');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject.length).toBeLessThan(160);
    expect(foreignTargets(m)).toEqual([]);
    expect(htmlTargets(m.html)).toEqual([LINK]);
    expect(() =>
      buildOutgoing({ to: 'a@example.com', mail: m, idempotencyKey: 'seat_invite:x:1' }),
    ).not.toThrow();
  });

  it.each(['', 'short', `${TOKEN}x`, '../../evil', `${'T'.repeat(42)}/`])(
    'refuses a token that is not one (%j), rather than linking it',
    (token) => {
      expect(() => seatInvite({ token, accountName: null, role: 'developer' })).toThrow(RangeError);
    },
  );
});
