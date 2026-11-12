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
    // The zone by its short name, never the IANA name (rulings-3 item 4).
    expect(m.text).toContain('Your Pro trial ends on Sat 7 Nov at 21:41 EST.');
    expect(m.html).toContain('Your Pro trial ends on Sat 7 Nov at 21:41 EST.');
    expect(`${m.text}${m.html}`).not.toContain('America/');
    expect(m.text).toContain('No card is on file, so nothing is charged.');
    expect(htmlTargets(m.html)).toEqual([
      'https://crawlmouse.com/trial-ended',
      'https://crawlmouse.com/settings',
    ]);
    expect(m.html).not.toMatch(/unsubscribe/i);
  });

  it('says a trial with a card becomes the plan unless cancelled', () => {
    const m = trialReminder({
      plan: 'agency',
      variant: 'card_required',
      endsAt: ENDS,
      timezone: 'UTC',
    });
    expect(m.subject).toBe('Your Crawlmouse Agency trial ends Sun 8 Nov');
    expect(m.text).toContain(
      'the card on file is charged for Agency unless you cancel in Settings',
    );
  });

  it('falls back to UTC for a zone the runtime does not know', () => {
    const m = trialReminder({
      plan: 'pro',
      variant: 'no_card',
      endsAt: ENDS,
      timezone: 'Mars/Base',
    });
    expect(m.text).toContain('Sun 8 Nov at 02:41 UTC.');
  });

  it('says “your time” for a zone Intl names only by an offset', () => {
    const m = trialReminder({
      plan: 'pro',
      variant: 'no_card',
      endsAt: ENDS,
      timezone: 'Asia/Tokyo',
    });
    expect(m.text).toContain('Your Pro trial ends on Sun 8 Nov at 11:41 your time.');
    expect(m.text).not.toContain('Asia/');
  });
});
