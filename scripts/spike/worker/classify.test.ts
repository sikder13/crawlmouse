import { describe, it, expect } from 'vitest';
import {
  classifyResponse,
  classifyControl,
  decide,
  witness,
  classifyPage,
  summarize,
  type PageObs,
  type ResponseShape,
  type UResult,
  type Verdict,
} from './classify.js';
import { CRAWLER_TOKENS, type Token } from './identities.js';
import { SITE_EXPECTATIONS, matchesExpectation, shapePages } from '../fixtures/shapes.js';

const ok = (words = 500): ResponseShape => ({ status: 200, headers: {}, bodyHead: '<html>', words });

describe('classifyResponse: signatures', () => {
  const cases: Array<[string, ResponseShape, UResult]> = [
    ['200 page', ok(), 'served'],
    ['plain 403', { status: 403, headers: { server: 'nginx' }, bodyHead: 'Forbidden', words: 1 }, 'refused'],
    ['451', { status: 451, headers: {}, bodyHead: '', words: 0 }, 'refused'],
    ['999', { status: 999, headers: {}, bodyHead: '', words: 0 }, 'refused'],
    ['cloudflare 1020 body', { status: 403, headers: { server: 'cloudflare' }, bodyHead: 'error code: 1020', words: 3 }, 'refused'],
    ['cloudflare 1010 body', { status: 403, headers: { server: 'cloudflare' }, bodyHead: 'error code: 1010', words: 3 }, 'refused'],
    ['cf-mitigated challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' }, bodyHead: '', words: 0 }, 'challenged'],
    ['just a moment', { status: 503, headers: {}, bodyHead: '<title>Just a moment...</title>', words: 3 }, 'challenged'],
    ['vercel mitigated', { status: 429, headers: { 'x-vercel-mitigated': 'challenge' }, bodyHead: '', words: 0 }, 'challenged'],
    ['datadome', { status: 403, headers: {}, bodyHead: '<script src="https://ct.captcha-delivery.com/c.js">', words: 0 }, 'challenged'],
    ['imperva', { status: 403, headers: { 'x-iinfo': '1' }, bodyHead: 'Incapsula incident ID: 123', words: 4 }, 'challenged'],
    ['429 without signature', { status: 429, headers: {}, bodyHead: '', words: 0 }, 'limited'],
    ['cloudflare 1015', { status: 429, headers: { 'cf-ray': 'x' }, bodyHead: 'error code: 1015', words: 3 }, 'limited'],
    ['430', { status: 430, headers: {}, bodyHead: '', words: 0 }, 'limited'],
    ['402', { status: 402, headers: { 'crawler-price': 'USD 0.01' }, bodyHead: '', words: 0 }, 'payment'],
    ['500', { status: 500, headers: {}, bodyHead: '', words: 0 }, 'error'],
    ['status 0', { status: 0, headers: {}, bodyHead: '', words: 0 }, 'error'],
    ['cross-host redirect', { status: 200, headers: {}, bodyHead: '', words: 50, originHost: 'a.test', finalHost: 'login.b.test' }, 'redirected'],
    ['302 not followed', { status: 302, headers: { location: 'https://x.test/' }, bodyHead: '', words: 0 }, 'redirected'],
  ];
  it.each(cases)('%s', (_n, r, want) => expect(classifyResponse(r)).toBe(want));

  it('challenge signature wins over a refusal status', () => {
    expect(classifyResponse({ status: 403, headers: { 'cf-mitigated': 'challenge' }, bodyHead: 'Access denied', words: 2 })).toBe('challenged');
  });
});

describe('classifyControl (K)', () => {
  it('ok only when both controls are 200 without a challenge signature', () => {
    expect(classifyControl([ok(), ok()])).toBe('ok');
  });
  it('gone when both are 404/410', () => {
    const gone = { status: 404, headers: {}, bodyHead: '', words: 0 };
    expect(classifyControl([gone, { ...gone, status: 410 }])).toBe('gone');
  });
  it('fail when either control is anything else', () => {
    const f = { status: 403, headers: {}, bodyHead: '', words: 0 };
    expect(classifyControl([ok(), f])).toBe('fail');
    expect(classifyControl([f, f])).toBe('fail');
    expect(classifyControl([ok(), { status: 404, headers: {}, bodyHead: '', words: 0 }])).toBe('fail');
  });
});

const allow = Object.fromEntries(CRAWLER_TOKENS.map((t) => [t, 'allowed'])) as Record<Token, 'allowed' | 'disallowed'>;
const uAll = (u: UResult) => Object.fromEntries(CRAWLER_TOKENS.map((t) => [t, u])) as Record<Token, UResult>;
const page = (over: Partial<PageObs>): PageObs => ({
  robots: allow,
  K: 'ok',
  controlWords: 500,
  U: uAll('served'),
  words: Object.fromEntries(CRAWLER_TOKENS.map((t) => [t, 500])) as Record<Token, number>,
  G: 'not_run',
  ...over,
});

describe('decide: every row of the ENGINE-GAP 3.5a table', () => {
  const v = (over: Parameters<typeof decide>[0]) => decide(over);
  const base = { R: 'allowed', K: 'ok', U: 'served', W: false, words: 500, controlWords: 500 } as const;

  it('row 1: robots disallow wins whatever K is', () => {
    expect(v({ ...base, R: 'disallowed', K: 'fail', U: 'not_fetched' })).toEqual({ verdict: 'disallowed_by_robots', row: '1', scored: true });
  });
  it('row 2 and 2b', () => {
    expect(v({ ...base, K: 'gone' }).verdict).toBe('not_measured');
    expect(v({ ...base, K: 'fail' })).toMatchObject({ verdict: 'edge_blocks_automation', row: '2b', scored: false });
  });
  it('row 3: words at exactly 80% of control are allowed, just under are thin', () => {
    expect(v({ ...base, words: 400 }).verdict).toBe('allowed');
    expect(v({ ...base, words: 399 }).verdict).toBe('allowed_thin');
  });
  it('row 4', () => {
    expect(v({ ...base, U: 'limited' }).verdict).toBe('rate_limited');
    expect(v({ ...base, U: 'payment' }).verdict).toBe('payment_required');
    expect(v({ ...base, U: 'redirected' }).verdict).toBe('redirected_away');
    expect(v({ ...base, U: 'error' }).verdict).toBe('not_measured');
  });
  it('row 5: refused with a witness is a UA rule', () => {
    expect(v({ ...base, U: 'refused', W: true })).toEqual({ verdict: 'blocked_by_ua_rule', row: '5', scored: true });
  });
  it('rows 6 and 7: challenged is challenged_ua with or without a witness', () => {
    expect(v({ ...base, U: 'challenged', W: true })).toMatchObject({ verdict: 'challenged_ua', row: '6' });
    expect(v({ ...base, U: 'challenged', W: false })).toMatchObject({ verdict: 'challenged_ua', row: '7' });
  });
  it('row 8: refused with no witness is unverified and unscored', () => {
    expect(v({ ...base, U: 'refused', W: false })).toEqual({ verdict: 'refused_unverified', row: '8', scored: false });
  });
});

describe('witness', () => {
  it('is true when any OTHER identity was served, false when only the identity itself was', () => {
    const p = page({ U: { ...uAll('refused'), ClaudeBot: 'served' } });
    expect(witness(p, 'GPTBot')).toBe(true);
    expect(witness(p, 'ClaudeBot')).toBe(false);
  });
  it('counts a served tagged Googlebot fetch', () => {
    expect(witness(page({ U: uAll('refused'), G: 'served' }), 'GPTBot')).toBe(true);
    expect(witness(page({ U: uAll('refused'), G: 'refused' }), 'GPTBot')).toBe(false);
    expect(witness(page({ U: uAll('refused'), G: 'challenged' }), 'GPTBot')).toBe(false);
  });
  it('does not count tokens that were not fetched', () => {
    expect(witness(page({ U: uAll('not_fetched'), G: 'not_run' }), 'GPTBot')).toBe(false);
  });
});

describe('the five discriminator shapes (spike criterion 3, run from recorded response shapes)', () => {
  for (const site of Object.keys(SITE_EXPECTATIONS)) {
    it(`${site}: verdict split matches the ENGINE-GAP 3.5a classification`, () => {
      const pages = shapePages(site);
      expect(pages.length).toBe(20);
      const summary = summarize(pages.map(classifyPage));
      expect(matchesExpectation(site, summary)).toEqual({ ok: true, misses: [] });
    });
  }

  it('nike.com exact verdicts per token', () => {
    const s = summarize(shapePages('nike.com').map(classifyPage));
    const want: Record<string, Verdict> = {
      'OAI-SearchBot': 'blocked_by_ua_rule',
      'ChatGPT-User': 'blocked_by_ua_rule',
      PerplexityBot: 'blocked_by_ua_rule',
      GPTBot: 'blocked_by_ua_rule',
      'Claude-SearchBot': 'allowed',
      ClaudeBot: 'allowed',
    };
    for (const [t, verdict] of Object.entries(want)) expect(s[t as Token]).toEqual({ [verdict]: 20 });
  });

  it('css-tricks without the Googlebot witness falls to row 8, so the canary stays in the method', () => {
    const noG = shapePages('css-tricks.com').map((p) => ({ ...p, G: 'not_run' as const }));
    const s = summarize(noG.map(classifyPage));
    expect(s.GPTBot).toEqual({ refused_unverified: 20 });
  });

  it('neilpatel.com: 17 challenged, 3 allowed', () => {
    const s = summarize(shapePages('neilpatel.com').map(classifyPage));
    expect(s.GPTBot).toEqual({ challenged_ua: 17, allowed: 3 });
  });

  it('cnn.com: robots disallow means nothing was fetched for the six tokens', () => {
    const pages = shapePages('cnn.com');
    for (const p of pages) for (const t of CRAWLER_TOKENS) expect(p.U[t]).toBe('not_fetched');
    expect(summarize(pages.map(classifyPage)).ClaudeBot).toEqual({ disallowed_by_robots: 20 });
  });
});

describe('matchesExpectation tolerance', () => {
  it('accepts a split within 2 pages of 20 and rejects 3 away', () => {
    const mk = (challenged: number) =>
      Object.fromEntries(CRAWLER_TOKENS.map((t) => [t, { challenged_ua: challenged, allowed: 20 - challenged }])) as ReturnType<typeof summarize>;
    expect(matchesExpectation('neilpatel.com', mk(15)).ok).toBe(true);
    expect(matchesExpectation('neilpatel.com', mk(19)).ok).toBe(true);
    expect(matchesExpectation('neilpatel.com', mk(14)).ok).toBe(false);
  });
  it('a token with no counts at all is a miss', () => {
    expect(matchesExpectation('nike.com', {} as ReturnType<typeof summarize>).ok).toBe(false);
  });
});
