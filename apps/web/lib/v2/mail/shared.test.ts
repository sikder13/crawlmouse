import { afterEach, describe, expect, it, vi } from 'vitest';
import { bounded, html, oneLine } from './escape';
import { layout } from './layout';
import { checkUrl, mailOrigin, PRODUCTION_MAIL_ORIGIN } from './links';
import { alertTemplate, pageUrl } from './templates/alert';
import { htmlTargets } from './templates/inspect';
import { linkSecret, signUnsubscribe, verifyUnsubscribe } from './unsubscribe-token';

const SECRET = 's'.repeat(40);
const SEAT = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-11-13T10:00:00.000Z');

describe('escape (D3)', () => {
  it('escapes the five HTML characters', () => {
    expect(html(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
  it('bounds by code points, with an ellipsis, and replaces control characters', () => {
    expect(bounded('abcdef', 4)).toBe('abc…');
    expect(bounded('abc', 3)).toBe('abc');
    expect([...bounded('😀'.repeat(10), 5)]).toHaveLength(5);
    expect(bounded('a\u0000b\u2028c', 10)).toBe('a b c');
  });
  it('folds lines for a one-line value', () => {
    expect(oneLine(' a\r\n\tb   c ', 20)).toBe('a b c');
  });
});

describe('layout', () => {
  it('escapes the title and the reason, and links unsubscribe only when given', () => {
    const out = layout({ title: '<b>x</b>', body: '<p>ok</p>', why: 'Because <you>' });
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(out).toContain('Because &lt;you&gt;');
    expect(out).not.toContain('Unsubscribe');
    expect(
      layout({
        title: 't',
        body: '',
        why: 'w',
        unsubscribeUrl: 'https://crawlmouse.com/unsubscribe?t=a"b',
      }),
    ).toContain('href="https://crawlmouse.com/unsubscribe?t=a&quot;b"');
  });
});

describe('the unsubscribe token (D7)', () => {
  it('round-trips a seat and a kind', () => {
    const t = signUnsubscribe(SECRET, SEAT, 'alerts', NOW);
    expect(verifyUnsubscribe(SECRET, t, NOW)).toEqual({ ok: true, seatId: SEAT, kind: 'alerts' });
  });
  it('expires after its days', () => {
    const t = signUnsubscribe(SECRET, SEAT, 'summary', NOW, 1);
    expect(verifyUnsubscribe(SECRET, t, new Date(NOW.getTime() + 86_400_000 - 1000)).ok).toBe(true);
    expect(verifyUnsubscribe(SECRET, t, new Date(NOW.getTime() + 86_400_000))).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
  it('refuses another secret, an edited payload and a malformed token', () => {
    const t = signUnsubscribe(SECRET, SEAT, 'alerts', NOW);
    expect(verifyUnsubscribe('o'.repeat(40), t, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    const [p, mac] = t.split('.');
    const edited = Buffer.from(JSON.stringify({ s: SEAT, k: 'summary', x: 9e9 })).toString(
      'base64url',
    );
    expect(verifyUnsubscribe(SECRET, `${edited}.${mac}`, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    for (const bad of ['', 'a', `${p}.${mac}.x`, `${p}!.${mac}`, 'x'.repeat(600)]) {
      expect(verifyUnsubscribe(SECRET, bad, NOW).ok).toBe(false);
    }
  });
  it('treats a missing or short secret as unset', () => {
    expect(linkSecret({})).toBeNull();
    expect(linkSecret({ EMAIL_LINK_SECRET: 'short' })).toBeNull();
    expect(linkSecret({ EMAIL_LINK_SECRET: SECRET })).toBe(SECRET);
  });
});

describe('the page links (links.ts and templates/alert.ts)', () => {
  it('share one origin and refuse the same ids', () => {
    const id = 'c0000000-0000-4000-8000-0000000000aa';
    expect(pageUrl('/audit/', id)).toBe(checkUrl(id));
    for (const bad of ['', 'x', `${id}/../alerts`, id.toUpperCase(), `${id} `]) {
      expect(() => pageUrl('/audit/', bad)).toThrow(RangeError);
      expect(() => checkUrl(bad)).toThrow(RangeError);
    }
  });
});

describe('mailOrigin: where mail links point (F-253)', () => {
  afterEach(() => vi.unstubAllEnvs());
  const id = 'c0000000-0000-4000-8000-0000000000aa';

  it('is production with no origin named', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    expect(mailOrigin()).toBe('https://crawlmouse.com');
    expect(PRODUCTION_MAIL_ORIGIN).toBe('https://crawlmouse.com');
  });

  it('is the deployment’s own origin, so staging’s mail opens staging, in every link builder', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://staging.crawlmouse.example/');
    expect(mailOrigin()).toBe('https://staging.crawlmouse.example');
    expect(checkUrl(id)).toBe(`https://staging.crawlmouse.example/audit/${id}`);
    expect(pageUrl('/sites/', id)).toBe(`https://staging.crawlmouse.example/sites/${id}`);
  });

  it('points every link of an alert at that origin: check, fix and rules pages (F-253)', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://staging.crawlmouse.example');
    const unsubscribe = 'https://staging.crawlmouse.example/unsubscribe?t=x.y';
    const m = alertTemplate({
      host: 'shop.example',
      checkId: id,
      checkedAt: '2026-11-13T10:58:00Z',
      zone: 'UTC',
      rules: [],
      unsubscribeUrl: unsubscribe,
      changes: [
        {
          kind: 'opened',
          subject: 'orphans',
          severity: 'warn',
          summary: '3 orphan pages',
          where: '/blog/*',
          pages_affected: 3,
          ua: null,
          grade_deltas: [],
          fix_id: 'f0000000-0000-4000-8000-000000000001',
        },
      ],
    });
    const targets = htmlTargets(m.html);
    // The check, the fix, the rules page and the unsubscribe page: four, all on staging.
    expect(targets.length).toBeGreaterThanOrEqual(4);
    for (const t of targets) expect(t, t).toMatch(/^https:\/\/staging\.crawlmouse\.example\//);
    expect(targets).toContain('https://staging.crawlmouse.example/alerts');
  });

  it('falls back to production for anything but a bare https origin', () => {
    for (const odd of [
      'http://staging.crawlmouse.example',
      'https://staging.crawlmouse.example/path',
      'https://staging.crawlmouse.example?x=1',
      'https://user:pw@staging.crawlmouse.example',
      'javascript:alert(1)',
      'not a url',
    ]) {
      vi.stubEnv('NEXT_PUBLIC_BASE_URL', odd);
      expect(mailOrigin(), odd).toBe('https://crawlmouse.com');
    }
  });
});
