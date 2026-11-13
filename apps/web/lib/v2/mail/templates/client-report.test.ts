import { describe, expect, it } from 'vitest';
import { buildOutgoing, unsubscribeHeaders } from '../headers';
import { reportPauseUrl } from '../links';
import { clientReport, type ClientReportInput } from './client-report';
import { anchorCount, foreignTargets, htmlTargets, textUrls } from './inspect';

const SHARE = 'S'.repeat(22);
const PAUSE = 'P'.repeat(43);
const REPORT = `https://crawlmouse.com/s/${SHARE}`;
const PAUSE_LINK = `https://crawlmouse.com/s/pause/${PAUSE}`;
const HOSTILE = '<script>x</script>"\'&\r\nBcc: victim@example.com https://evil.example/';

const input = (over: Partial<ClientReportInput> = {}): ClientReportInput => ({
  agencyName: 'Summit Digital',
  host: 'example.com',
  headline: 'AI readability went from D to B',
  lines: ['example.com', 'Checked Fri 30 Oct'],
  footer: 'Checked with Crawlmouse · Fri 30 Oct',
  shareToken: SHARE,
  pauseToken: PAUSE,
  ...over,
});

describe('client-report (CC-31 D8)', () => {
  it('names the site and the agency in the subject, and shows the document’s headline and lines as given', () => {
    const m = clientReport(input());
    expect(m.subject).toBe('Report for example.com from Summit Digital');
    expect(m.text.split('\n').slice(0, 3)).toEqual([
      'AI readability went from D to B',
      'example.com',
      'Checked Fri 30 Oct',
    ]);
    expect(m.html).toContain('<h1>AI readability went from D to B</h1>');
    expect(m.html).toContain('<p>example.com</p><p>Checked Fri 30 Oct</p>');
  });

  it('links the report and the pause page, and nothing else', () => {
    const m = clientReport(input());
    expect(htmlTargets(m.html)).toEqual([REPORT, PAUSE_LINK]);
    expect(anchorCount(m.html)).toBe(2);
    expect(textUrls(m.text)).toEqual([REPORT, PAUSE_LINK]);
    expect(m.text).toContain(`Open the report: ${REPORT}`);
    expect(m.text).toContain(`Pause these reports: ${PAUSE_LINK}`);
  });

  it('ends with the document’s closing line, as given', () => {
    const m = clientReport(input());
    expect(m.text).toContain('\nChecked with Crawlmouse · Fri 30 Oct\n');
    expect(m.html).toContain('Checked with Crawlmouse · Fri 30 Oct</p>');
  });

  it('states nothing the document did not give it: no digit beyond the input’s own', () => {
    const m = clientReport(
      input({ headline: 'Nothing blocks the site', lines: ['example.com'], footer: 'Checked' }),
    );
    const words = `${m.subject}\n${m.text.replace(/https:\/\/\S+/g, '')}`;
    expect(words).not.toMatch(/\d/);
    expect(words).not.toMatch(/\bgrades?\b|\bscores?\b/i);
  });

  it('names no agency when the account has no name', () => {
    const m = clientReport(input({ agencyName: null }));
    expect(m.subject).toBe('Report for example.com');
  });

  it('its pause link is the one List-Unsubscribe carries', () => {
    const m = clientReport(input());
    const out = buildOutgoing({
      to: 'a@example.com',
      mail: m,
      idempotencyKey: 'client_report:x',
      headers: unsubscribeHeaders({ url: reportPauseUrl(PAUSE) }),
    });
    expect(out.headers).toEqual({
      'List-Unsubscribe': `<${PAUSE_LINK}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(htmlTargets(m.html)).toContain(PAUSE_LINK);
  });

  it.each(['agencyName', 'host', 'headline', 'footer'] as const)(
    'escapes, bounds and folds %s, and never links it',
    (field) => {
      const m = clientReport(input({ [field]: HOSTILE.repeat(20) }));
      expect(m.html).not.toContain('<script>');
      expect(m.subject).not.toMatch(/[\r\n]/);
      expect(m.subject.length).toBeLessThanOrEqual(200);
      expect(foreignTargets(m)).toEqual([]);
      expect(htmlTargets(m.html)).toEqual([REPORT, PAUSE_LINK]);
      expect(() =>
        buildOutgoing({ to: 'a@example.com', mail: m, idempotencyKey: 'client_report:x' }),
      ).not.toThrow();
    },
  );

  it('escapes and bounds each line', () => {
    const m = clientReport(input({ lines: [HOSTILE.repeat(20), 'second'] }));
    expect(m.html).not.toContain('<script>');
    expect(foreignTargets(m)).toEqual([]);
    expect(m.text.split('\n')[1]!.length).toBeLessThanOrEqual(300);
    expect(m.text.split('\n')[2]).toBe('second');
  });

  it.each([
    ['shareToken', ''],
    ['shareToken', 'S'.repeat(21)],
    ['shareToken', 'S'.repeat(43)],
    ['shareToken', 'pause/../../evil-evil-evil'],
    ['pauseToken', ''],
    ['pauseToken', 'P'.repeat(22)],
    ['pauseToken', '../../evil'],
  ] as const)('refuses a %s that is not one (%j), rather than linking it', (field, value) => {
    expect(() => clientReport(input({ [field]: value }))).toThrow(RangeError);
  });
});
