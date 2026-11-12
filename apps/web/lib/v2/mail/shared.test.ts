import { describe, expect, it } from 'vitest';
import { bounded, html, oneLine } from './escape';
import { layout } from './layout';
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
