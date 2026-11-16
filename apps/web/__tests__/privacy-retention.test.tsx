/**
 * The privacy page's Data retention list (CC-41 rulings 3): with V2_CHECKS_PUBLIC off, exactly main's
 * list; with it on, v2's: an audit nobody keeps, an audit kept by an account, the de-identified
 * research records, then main's other three lines. Each number is rendered from its constant (a test
 * gives the constants other values and reads them back).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Main's list (05926f09) as React renders it: the flag-off page must render it byte for byte. */
const MAIN_LIST =
  '<ul class="list-disc pl-6 space-y-2">' +
  '<li>Free-tier audits are deleted automatically 30 days after they are created.</li>' +
  '<li>Account data (your email and billing status) is kept until you request deletion.</li>' +
  '<li>Billing and tax records are kept for as long as applicable law requires, which is generally up to seven (7) years.</li>' +
  '<li>Analytics and error-telemetry data is retained for a limited window in line with each vendor’s defaults; rate-limit and anti-abuse records are short-lived.</li>' +
  '</ul>';

async function retentionList(flag: string | undefined): Promise<string> {
  vi.resetModules();
  vi.stubEnv('V2_CHECKS_PUBLIC', flag);
  const { default: PrivacyPage } = await import('../app/privacy/page');
  const html = renderToStaticMarkup(<PrivacyPage />);
  const at = html.indexOf('Data retention</h2>');
  expect(at).toBeGreaterThan(0);
  const start = html.indexOf('<ul', at);
  return html.slice(start, html.indexOf('</ul>', start) + '</ul>'.length);
}

const items = (list: string) =>
  [...list.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@/lib/v2/pipeline/limits');
  vi.doUnmock('@/lib/v2/copy/restore-window');
});

describe('the privacy page’s Data retention list', () => {
  it('with V2_CHECKS_PUBLIC off is main’s, byte for byte', async () => {
    expect(await retentionList(undefined)).toBe(MAIN_LIST);
  });

  it('with V2_CHECKS_PUBLIC on states v2’s rules, then main’s other three lines', async () => {
    const { ANONYMOUS_EXPIRY_HOURS } = await import('../lib/v2/pipeline/limits');
    const { RESTORE_DAYS } = await import('../lib/v2/copy/restore-window');
    const list = items(await retentionList('1'));
    expect(list).toHaveLength(6);
    expect(list[0]).toBe(
      `An audit nobody keeps is deleted, together with its stored evidence, at the first daily cleanup once ${ANONYMOUS_EXPIRY_HOURS} hours have passed since it was requested.`,
    );
    expect(list[1]).toBe(
      `An audit kept by an account stays for as long as the account exists. Deleting the account deletes its audits, once the ${RESTORE_DAYS}-day restore window has passed.`,
    );
    expect(list[2]).toMatch(/^De-identified research records: /);
    expect(list[2]).toContain(
      'no account, email, URL or page path, and no time finer than the month',
    );
    expect(list[2]).toContain('kept indefinitely');
    expect(list.slice(3)).toEqual(items(MAIN_LIST).slice(1));
    expect(list.join(' ')).not.toContain('30 days');
  });

  it('renders the hours and the restore days from their constants', async () => {
    vi.doMock('@/lib/v2/pipeline/limits', async (orig) => ({
      ...(await orig<object>()),
      ANONYMOUS_EXPIRY_HOURS: 37,
    }));
    vi.doMock('@/lib/v2/copy/restore-window', () => ({ RESTORE_DAYS: 11 }));
    const list = items(await retentionList('1'));
    expect(list[0]).toContain('once 37 hours have passed');
    expect(list[1]).toContain('the 11-day restore window');
  });
});
