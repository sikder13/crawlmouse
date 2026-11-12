import { describe, expect, it, vi } from 'vitest';
import type { MailChange } from '../mail/templates/alert';
import { isSlackWebhook, slackAlertText, slackEscape, slackPoster, SLACK_ROWS_MAX } from './slack';

const URL_A = 'https://hooks.slack.com/services/T0000/B0000/abcdWXYZsecret';
const CHECK = 'c0000000-0000-4000-8000-000000000006';

const change = (o: Partial<MailChange> = {}): MailChange => ({
  kind: 'opened',
  subject: 'crawler_access',
  severity: 'bad',
  summary: 'GPTBot: allowed → disallowed by robots.txt',
  where: 'robots.txt',
  pages_affected: 12,
  ua: 'GPTBot',
  grade_deltas: [],
  ...o,
});

describe('the Slack message (D5)', () => {
  const base = {
    host: 'shop.example',
    checkId: CHECK,
    checkedAt: '2026-11-13T11:00:00Z',
    zone: 'UTC',
  };

  it('is plain text we build: a line, the rows problems first, and the check’s page', () => {
    const text = slackAlertText({
      ...base,
      changes: [
        change({
          kind: 'changed',
          subject: 'content',
          severity: null,
          ua: null,
          summary: 'copy edited',
        }),
        change(),
      ],
    });
    expect(text.split('\n')).toEqual([
      'Crawlmouse: 2 changes on shop.example at the check that finished Fri 13 Nov 11:00',
      '• Problem: GPTBot: allowed → disallowed by robots.txt (robots.txt, 12 pages)',
      '• Changed: copy edited (robots.txt, 12 pages)',
      `Open the check: https://crawlmouse.com/audit/${CHECK}`,
    ]);
  });

  it('escapes Slack’s markup in every outside string, so a page cannot mention a channel or make a link', () => {
    const text = slackAlertText({
      ...base,
      host: 'x<!channel>.example',
      changes: [
        change({ summary: '<!channel> <https://evil.example|click> & co', where: '<@U1>' }),
      ],
    });
    expect(text).not.toMatch(/<[!@h]/);
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).toContain('&amp; co');
    expect(slackEscape('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });

  it('lists the first rows and counts the rest', () => {
    const text = slackAlertText({
      ...base,
      changes: Array.from({ length: SLACK_ROWS_MAX + 2 }, () => change()),
    });
    expect(text.split('\n').filter((l) => l.startsWith('• '))).toHaveLength(SLACK_ROWS_MAX);
    expect(text).toContain('And 2 more.');
  });
});

describe('the POST', () => {
  const ok = () => new Response('ok', { status: 200 });

  it('accepts only the stored form on Slack’s host', () => {
    expect(isSlackWebhook(URL_A)).toBe(true);
    for (const bad of [
      URL_A.replace('https', 'http'),
      'https://hooks.slack.com.evil.example/services/T/B/x',
      `${URL_A}?x=1`,
      'https://hooks.slack.com:8443/services/T/B/x',
      'https://hooks.slack.com/other/T/B/x',
      `https://hooks.slack.com/services/${'a'.repeat(600)}`,
    ]) {
      expect(isSlackWebhook(bad)).toBe(false);
    }
  });

  it('posts JSON with previews off, follows no redirect, and answers ok on 2xx', async () => {
    const fetchMock = vi.fn(async () => ok());
    const post = slackPoster({ fetch: fetchMock as never, validate: async () => undefined });
    expect(await post(URL_A, 'hello')).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_A);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'hello',
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('refuses a URL the SSRF guard refuses, or that is not Slack’s, without a request', async () => {
    const fetchMock = vi.fn(async () => ok());
    const refused = slackPoster({
      fetch: fetchMock as never,
      validate: async () => {
        throw new Error(`blocked ${URL_A}`);
      },
    });
    expect(await refused(URL_A, 't')).toEqual({
      ok: false,
      code: 'slack_url_refused',
      retryable: false,
    });
    const post = slackPoster({ fetch: fetchMock as never, validate: async () => undefined });
    expect(await post('https://evil.example/services/x', 't')).toMatchObject({
      code: 'slack_url_refused',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers failures as codes that never carry the URL', async () => {
    const cases: [() => Promise<Response>, object][] = [
      [async () => new Response('', { status: 500 }), { code: 'slack_500', retryable: true }],
      [async () => new Response('', { status: 429 }), { code: 'slack_429', retryable: true }],
      [async () => new Response('', { status: 404 }), { code: 'slack_404', retryable: false }],
      [
        async () => new Response('', { status: 302, headers: { location: 'http://10.0.0.1/' } }),
        { code: 'slack_302', retryable: false },
      ],
      [
        async () => {
          throw new TypeError(`fetch failed ${URL_A}`);
        },
        { code: 'network', retryable: true },
      ],
    ];
    for (const [answer, want] of cases) {
      const out = await slackPoster({ fetch: answer as never, validate: async () => undefined })(
        URL_A,
        't',
      );
      expect(out).toMatchObject({ ok: false, ...want });
      expect(JSON.stringify(out)).not.toContain('hooks.slack.com');
    }
  });
});
