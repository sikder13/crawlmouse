import { describe, expect, it } from 'vitest';
import { isId, meantMethod, paywall } from './route';

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
    expect(await r.json()).toEqual({ error: 'upgrade_required', gate: 'stagingAndDeployHooks' });
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
