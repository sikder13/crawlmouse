import { describe, expect, it } from 'vitest';
import { buildOutgoing } from '../headers';
import { foreignTargets, htmlTargets, textUrls } from './inspect';
import { reportConfirm } from './report-confirm';

const TOKEN = 'C'.repeat(43);
const LINK = `https://crawlmouse.com/s/confirm/${TOKEN}`;
const HOSTILE = '<script>x</script>"\'&\r\nBcc: victim@example.com https://evil.example/';

describe('report-confirm (CC-31 D8)', () => {
  it('says which agency asks to send reports about which site, and links the confirmation alone', () => {
    const m = reportConfirm({ token: TOKEN, agencyName: 'Summit Digital', host: 'example.com' });
    expect(m.subject).toBe('Summit Digital asks to send you reports about example.com');
    expect(m.text).toContain('Summit Digital asks to send you reports about example.com.');
    expect(htmlTargets(m.html)).toEqual([LINK]);
    expect(textUrls(m.text)).toEqual([LINK]);
  });

  it('says nothing is sent unless they confirm, and that no account is needed', () => {
    const m = reportConfirm({ token: TOKEN, agencyName: 'Summit Digital', host: 'example.com' });
    for (const part of [m.text, m.html]) {
      expect(part).toContain('No report is sent unless you confirm');
      expect(part).toContain('You need no account');
    }
  });

  it.each([null, '', '  '])('names no agency when the account has no name (%j)', (agencyName) => {
    const m = reportConfirm({ token: TOKEN, agencyName, host: 'example.com' });
    expect(m.subject).toBe('An agency asks to send you reports about example.com');
    expect(m.text).toContain('An agency asks to send you reports about example.com.');
  });

  it.each(['agencyName', 'host'] as const)(
    'escapes, bounds and folds %s, and never links it',
    (field) => {
      const input = { token: TOKEN, agencyName: 'Summit Digital', host: 'example.com' };
      const m = reportConfirm({ ...input, [field]: HOSTILE.repeat(20) });
      expect(m.html).not.toContain('<script>');
      expect(m.subject).not.toMatch(/[\r\n]/);
      expect(m.subject.length).toBeLessThanOrEqual(200);
      expect(foreignTargets(m)).toEqual([]);
      expect(htmlTargets(m.html)).toEqual([LINK]);
      expect(() =>
        buildOutgoing({ to: 'a@example.com', mail: m, idempotencyKey: 'report_confirm:x:1' }),
      ).not.toThrow();
    },
  );

  it.each(['', 'short', `${TOKEN}x`, '../../evil'])(
    'refuses a token that is not one (%j), rather than linking it',
    (token) => {
      expect(() => reportConfirm({ token, agencyName: null, host: 'example.com' })).toThrow(
        RangeError,
      );
    },
  );
});
