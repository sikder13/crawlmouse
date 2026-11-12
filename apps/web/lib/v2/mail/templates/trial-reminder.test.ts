import { describe, expect, it } from 'vitest';
import { htmlTargets } from './inspect';
import { trialReminder } from './trial-reminder';

const ENDS = '2026-11-08T02:41:00.000Z';

describe('trial-reminder (D2; account mail, Q8)', () => {
  it('says when the trial ends in the account’s zone, and what happens without a card', () => {
    const m = trialReminder({
      plan: 'pro',
      variant: 'no_card',
      endsAt: ENDS,
      timezone: 'America/Indiana/Indianapolis',
    });
    expect(m.subject).toBe('Your Crawlmouse Pro trial ends Sat 7 Nov');
    expect(m.text).toContain('Your Pro trial ends on Sat 7 Nov at 21:41 (America/Indiana/Indianapolis).');
    expect(m.text).toContain('No card is on file, so nothing is charged.');
    expect(htmlTargets(m.html)).toEqual([
      'https://crawlmouse.com/trial-ended',
      'https://crawlmouse.com/settings',
    ]);
    expect(m.html).not.toMatch(/unsubscribe/i);
  });

  it('says a trial with a card becomes the plan unless cancelled', () => {
    const m = trialReminder({ plan: 'agency', variant: 'card_required', endsAt: ENDS, timezone: 'UTC' });
    expect(m.subject).toBe('Your Crawlmouse Agency trial ends Sun 8 Nov');
    expect(m.text).toContain('the card on file is charged for Agency unless you cancel in Settings');
  });

  it('falls back to UTC for a zone the runtime does not know', () => {
    const m = trialReminder({ plan: 'pro', variant: 'no_card', endsAt: ENDS, timezone: 'Mars/Base' });
    expect(m.text).toContain('Sun 8 Nov at 02:41 (UTC)');
  });
});
