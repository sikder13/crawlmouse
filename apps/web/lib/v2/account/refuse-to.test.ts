/**
 * A refusal a live form can show (CC-26b follow-up): a form is sent back to its page with the code
 * as `notice`, JSON gets the refusal body. Nothing the caller sent is put in the answer.
 */
import { describe, expect, it } from 'vitest';
import { NOTICE_CODES, noticeOf, refuseTo, tooSoonTo } from './route';

const SITE = '6f1c2a8e-0000-4000-8000-000000000000';
const req = (type: string | null) =>
  new Request('https://crawlmouse.com/api/sites', {
    method: 'POST',
    headers: type ? { 'content-type': type } : {},
    body: 'url=evil.example%3Cscript%3E',
  });
const form = req('application/x-www-form-urlencoded; charset=utf-8');
const json = req('application/json');

describe('refuseTo', () => {
  it('a form is sent back to its page with the code as the notice', () => {
    const res = refuseTo(form, '/dashboard', 409, 'site_exists', { siteId: SITE });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/dashboard?notice=site_exists');
  });

  it('JSON gets {code, …detail} with the status', async () => {
    const res = refuseTo(json, '/dashboard', 409, 'site_exists', { siteId: SITE });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'site_exists', siteId: SITE });
  });

  it('a request that declares neither is answered as JSON', () => {
    expect(refuseTo(req(null), '/dashboard', 400, 'invalid').status).toBe(400);
  });

  it('a site page is a valid place to go back to', () => {
    const res = refuseTo(form, `/sites/${SITE}`, 409, 'site_paused');
    expect(res.headers.get('location')).toBe(`/sites/${SITE}?notice=site_paused`);
  });

  it('refuses to send a form anywhere but the dashboard or a site page', () => {
    for (const back of ['https://evil.example/', '//evil.example', '/sites/x', '/settings'])
      expect(() => refuseTo(form, back, 400, 'invalid')).toThrow(/back/);
  });

  it('a 401 and a 404 stay as they are for a form too: no page is named for a stranger', async () => {
    const a = refuseTo(form, `/sites/${SITE}`, 401, 'auth_required');
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual({ code: 'auth_required' });
    const b = refuseTo(form, `/sites/${SITE}`, 404, 'not_found');
    expect(b.status).toBe(404);
  });

  it('a code outside the notice set is a programming error for a form', () => {
    expect(() => refuseTo(form, '/dashboard', 400, 'url=evil' as never)).toThrow(/notice/);
  });
});

describe('tooSoonTo', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const next = '2026-11-10T13:30:00.000Z';

  it('a form carries the next-allowed time beside the notice', () => {
    const res = tooSoonTo(form, `/sites/${SITE}`, 'capped', next, now);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `/sites/${SITE}?notice=capped&next=${encodeURIComponent(next)}`,
    );
  });

  it('JSON is a 429 with Retry-After and nextAllowedAt', async () => {
    const res = tooSoonTo(json, `/sites/${SITE}`, 'capped', next, now);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe(String(90 * 60));
    expect(await res.json()).toEqual({ code: 'capped', nextAllowedAt: next });
  });
});

describe('noticeOf', () => {
  it('reads a known code, and the time only when it is a timestamp', () => {
    expect(noticeOf({ notice: 'capped', next: '2026-11-10T13:30:00.000Z' })).toEqual({
      code: 'capped',
      next: '2026-11-10T13:30:00.000Z',
    });
    expect(noticeOf({ notice: 'capped', next: '<b>soon</b>' })).toEqual({
      code: 'capped',
      next: null,
    });
  });

  it('an unknown, repeated or missing notice is none', () => {
    expect(noticeOf({ notice: 'hello' })).toBeNull();
    expect(noticeOf({ notice: '__proto__' })).toBeNull();
    expect(noticeOf({ notice: ['capped', 'paused'] })).toBeNull();
    expect(noticeOf({})).toBeNull();
  });

  it('every notice code is a plain lowercase word', () => {
    for (const c of NOTICE_CODES) expect(c).toMatch(/^[a-z_]+$/);
  });
});
