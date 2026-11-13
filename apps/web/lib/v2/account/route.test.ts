import { describe, expect, it } from 'vitest';
import { backFrom, isId, meantMethod, noticeTo, paywall, refuse, serviceRefusal } from './route';

const post = new Request('https://crawlmouse.com/api/sites/x', { method: 'POST' });

describe('meantMethod', () => {
  it('reads a form post with _method as that method, without the field', () => {
    expect(
      meantMethod(post, { kind: 'form', fields: { _method: 'patch', schedule: 'weekly' } }),
    ).toEqual({ method: 'PATCH', fields: { schedule: 'weekly' } });
  });

  it('leaves a JSON body, and a form without _method, as the request says', () => {
    expect(meantMethod(post, { kind: 'json', fields: { _method: 'DELETE' } })).toEqual({
      method: 'POST',
      fields: { _method: 'DELETE' },
    });
    expect(meantMethod(post, { kind: 'form', fields: { a: '1' } })).toEqual({
      method: 'POST',
      fields: { a: '1' },
    });
  });

  it('a non-POST request keeps its own method', () => {
    const patch = new Request('https://crawlmouse.com/api/sites/x', { method: 'PATCH' });
    expect(meantMethod(patch, { kind: 'form', fields: { _method: 'DELETE' } }).method).toBe(
      'PATCH',
    );
  });
});

describe('paywall', () => {
  it('is a 402 naming the gate', async () => {
    const r = paywall('stagingAndDeployHooks');
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ code: 'upgrade_required', gate: 'stagingAndDeployHooks' });
  });
});

describe('isId', () => {
  it('takes a lowercase uuid and nothing else', () => {
    expect(isId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
    expect(isId('0F8FAD5B-D9CB-469F-A165-70867728950E')).toBe(false);
    expect(isId('0f8fad5b-d9cb-469f-a165-70867728950e ')).toBe(false);
    expect(isId('1')).toBe(false);
  });
});

describe('refusals', () => {
  it('carry a code that detail cannot overwrite, and any headers', async () => {
    const r = refuse(429, 'capped', { code: 'x', nextAllowedAt: 'later' }, { 'retry-after': '60' });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(await r.json()).toEqual({ code: 'capped', nextAllowedAt: 'later' });
  });

  it.each(['paused', 'unavailable', 'capacity'] as const)('503 %s', async (code) => {
    const r = serviceRefusal(code);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ code });
  });
});

describe('the pages a form goes back to', () => {
  const ID = '50000000-0000-4000-8000-0000000000c9';
  const from = (referer: string | null) =>
    backFrom(
      new Request('https://crawlmouse.com/api/sites', {
        method: 'POST',
        headers: referer === null ? {} : { referer },
      }),
      '/fallback',
    );

  it('are the dashboard, Seats, Reports, an invitation, a recipient’s link pages, a site page, and an agency’s matrix, client reports and client page, on our own origin', () => {
    for (const path of [
      '/dashboard',
      '/seats',
      '/reports',
      '/invite',
      '/s/confirm',
      '/s/pause',
      '/s/decline',
      `/sites/${ID}`,
      '/agency',
      '/agency/reports',
      `/agency/clients/${ID}`,
    ]) {
      expect(from(`https://crawlmouse.com${path}`)).toBe(path);
      expect(from(`https://crawlmouse.com${path}?notice=capped#x`)).toBe(path);
    }
  });

  it('are no other page: any other path, another origin, or no Referer, is the fallback', () => {
    for (const referer of [
      'https://crawlmouse.com/agency/billing',
      'https://crawlmouse.com/agency/reports/x',
      'https://crawlmouse.com/s',
      'https://crawlmouse.com/s/view',
      'https://crawlmouse.com/agency/',
      'https://crawlmouse.com/agency/clients',
      'https://crawlmouse.com/agency/clients/not-an-id',
      `https://crawlmouse.com/agency/clients/${ID}/x`,
      'https://crawlmouse.com/agencyx',
      `https://crawlmouse.com/x/agency`,
      'https://crawlmouse.com/settings',
      'https://evil.example/agency',
      'not a url',
      null,
    ]) {
      expect(from(referer), String(referer)).toBe('/fallback');
    }
  });

  it('noticeTo sends a form back to one of them with its notice, and to no other page', () => {
    const res = noticeTo('/agency', 'site_exists');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/agency?notice=site_exists');
    expect(
      noticeTo(`/agency/clients/${ID}`, 'capped', '2026-11-03T10:00:00.000Z').headers.get(
        'location',
      ),
    ).toBe(`/agency/clients/${ID}?notice=capped&next=2026-11-03T10%3A00%3A00.000Z`);
    expect(() => noticeTo('/agency/billing', 'capped')).toThrow(/not a page to go back to/);
    expect(() => noticeTo('https://evil.example/agency', 'capped')).toThrow();
  });
});
