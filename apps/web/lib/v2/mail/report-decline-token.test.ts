import { describe, expect, it } from 'vitest';
import { reportDeclineToken } from './report-decline-token';
import { reportPauseToken } from './report-pause-token';

const SECRET = 's'.repeat(40);
const SITE = '50000000-0000-4000-8000-000000000001';
const OTHER = '50000000-0000-4000-8000-000000000002';

// The token of an address's "Don't ask me again" link. The expected values were computed outside
// this module (HMAC-SHA256 of `report_decline:<site>:<address>` under the secret, base64url), so a
// derivation that drops the site, the address or the secret does not agree with them.
describe('reportDeclineToken', () => {
  it('is the known answer for a site, an address and a secret: 43 base64url characters', () => {
    const token = reportDeclineToken(SECRET, SITE, 'reader@client.example');
    expect(token).toBe('bYMkNvTJW9m0gLhVfXBwSpgMnyzRLp8Uo_yYg2jcw-k');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is the same for the address in another case and with spaces around it', () => {
    expect(reportDeclineToken(SECRET, SITE, '  Reader@Client.Example ')).toBe(
      reportDeclineToken(SECRET, SITE, 'reader@client.example'),
    );
  });

  it('differs for another site, another address and another secret, and is not the pause link’s', () => {
    const token = reportDeclineToken(SECRET, SITE, 'reader@client.example');
    const others = [
      reportDeclineToken(SECRET, OTHER, 'reader@client.example'),
      reportDeclineToken(SECRET, SITE, 'other@client.example'),
      reportDeclineToken('t'.repeat(40), SITE, 'reader@client.example'),
      reportPauseToken(SECRET, SITE, 'reader@client.example'),
    ];
    expect(new Set([token, ...others]).size).toBe(5);
    expect(others[3]).toBe('Q47wqJi3yjjMbJc_giiUOeicCashAXzB-CFaC89QeX8');
  });

  it('refuses a value that is not a site id', () => {
    expect(() => reportDeclineToken(SECRET, 'x', 'reader@client.example')).toThrow(RangeError);
  });
});
