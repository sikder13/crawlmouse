/**
 * D-17: the trial card's last day reads "ends today at <time> <zone>". bad-site's Pro trial ends at
 * 8 Nov 02:41Z, which is Sat 7 Nov 21:41 in Indianapolis, after the clocks went back (EST).
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { viewAt } from './account';
import { accountShellView } from './account-shell';

const d = fixture('bad-site');
const ACCOUNT = d.accounts[0]!.id;
const trialAt = (now: string) =>
  accountShellView(viewAt(d, { accountId: ACCOUNT, now }), 'Sites', { role: 'owner' }).trial;

describe('the trial card names the zone of the time a trial ends today (D-17)', () => {
  it('on the last day, in the account’s zone', () => {
    expect(d.accounts[0]!.trial_ends_at).toBe('2026-11-08T02:41:00Z');
    expect(trialAt('2026-11-07T15:00:00.000Z')?.left).toBe('ends today at 21:41 EST');
  });

  it('a day before, it counts days and names no time', () => {
    expect(trialAt('2026-11-06T15:00:00.000Z')?.left).toBe('1 day left');
  });
});
