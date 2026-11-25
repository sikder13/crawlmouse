import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { senderName } from './report-mail-store';
import { clientReport } from './templates/client-report';

// Goal 1 row 24, white-label: who a scheduled client report says it is from.

const input = (agencyName: string | null) => ({
  agencyName,
  host: 'client.example',
  headline: 'Before and after',
  lines: ['client.example'],
  footer: 'Checked with Crawlmouse · Fri 30 Oct',
  shareToken: 'AbCdEfGhIjKlMnOpQrStUv',
  pauseToken: 'a'.repeat(43),
});

describe('a scheduled client report names its sender', () => {
  it('as the agency stamped on the report, over the account’s name', () => {
    expect(senderName({ brand: { name: 'Northwind Digital', logoPath: null } }, 'Summit LLC')).toBe(
      'Northwind Digital',
    );
  });

  it('as the account’s name for a report with no brand, exactly as before', () => {
    expect(senderName({}, 'Summit LLC')).toBe('Summit LLC');
    expect(senderName({}, null)).toBeNull();
  });

  it('the mail says the brand in its subject and footer, and shows no logo', () => {
    const m = clientReport(
      input(senderName({ brand: { name: 'Northwind', logoPath: 'x' } }, 'Summit')),
    );
    expect(m.subject).toBe('Report for client.example from Northwind');
    expect(m.html).toContain('Sent by Northwind');
    expect(m.html).not.toContain('<img');
    expect(m.text).not.toContain('Summit');
  });

  it('a name the templates’ no-link guard refuses is not shown', () => {
    const m = clientReport(
      input(senderName({ brand: { name: 'evil.example', logoPath: null } }, 'Summit')),
    );
    expect(m.subject).toBe('Report for client.example');
  });
});
