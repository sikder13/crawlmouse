import { describe, expect, it } from 'vitest';
import { readBody, refuse, respond, seeOther } from './request-body';

const post = (body: string, contentType?: string) =>
  new Request('https://crawlmouse.com/api/billing/checkout', {
    method: 'POST',
    headers: contentType === undefined ? {} : { 'content-type': contentType },
    body,
  });

describe('readBody', () => {
  it('reads a form post as strings', async () => {
    expect(
      await readBody(post('plan=pro&interval=month', 'application/x-www-form-urlencoded')),
    ).toEqual({ kind: 'form', fields: { plan: 'pro', interval: 'month' } });
  });

  it('reads a form post whose content type carries a charset, in any case', async () => {
    expect(
      await readBody(post('plan=agency', 'Application/X-WWW-Form-Urlencoded; charset=UTF-8')),
    ).toEqual({ kind: 'form', fields: { plan: 'agency' } });
  });

  it('decodes form values', async () => {
    expect(
      await readBody(post('confirm=true&note=a%20b%2Bc', 'application/x-www-form-urlencoded')),
    ).toEqual({ kind: 'form', fields: { confirm: 'true', note: 'a b+c' } });
  });

  it('refuses a form that names a field twice', async () => {
    expect(
      await readBody(post('plan=pro&plan=agency', 'application/x-www-form-urlencoded')),
    ).toBeNull();
  });

  it('reads a JSON object', async () => {
    expect(
      await readBody(post('{"confirm":true,"accountId":"a"}', 'application/json; charset=utf-8')),
    ).toEqual({ kind: 'json', fields: { confirm: true, accountId: 'a' } });
  });

  it.each([
    ['malformed JSON', '{"plan":'],
    ['a JSON array', '["pro"]'],
    ['JSON null', 'null'],
    ['a JSON string', '"pro"'],
  ])('refuses %s', async (_, body) => {
    expect(await readBody(post(body, 'application/json'))).toBeNull();
  });

  it('keeps a __proto__ key as an own field, where a strict schema refuses it', async () => {
    const form = await readBody(post('__proto__=x', 'application/x-www-form-urlencoded'));
    const json = await readBody(post('{"__proto__":{"plan":"pro"}}', 'application/json'));
    expect(Object.keys(form!.fields)).toEqual(['__proto__']);
    expect(Object.keys(json!.fields)).toEqual(['__proto__']);
    expect((json!.fields as { plan?: unknown }).plan).toBeUndefined();
  });

  it.each([
    ['form', 'application/x-www-form-urlencoded'],
    ['json', 'application/json'],
  ])('reads an empty %s body as no fields', async (kind, type) => {
    expect(await readBody(post('', type))).toEqual({ kind, fields: {} });
  });

  it.each([
    ['no content type', undefined],
    ['multipart', 'multipart/form-data; boundary=x'],
    ['plain text', 'text/plain'],
  ])('refuses a body with %s', async (_, type) => {
    expect(await readBody(post('plan=pro', type))).toBeNull();
  });
});

describe('the responses', () => {
  it('a form success is a 303 to the URL with no body', async () => {
    const res = respond('form', 'https://checkout.stripe.com/c/pay/cs_1');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://checkout.stripe.com/c/pay/cs_1');
    expect(await res.text()).toBe('');
  });

  it('a JSON success is 200 {url}', async () => {
    const res = respond('json', 'https://checkout.stripe.com/c/pay/cs_1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.text()).toBe('{"url":"https://checkout.stripe.com/c/pay/cs_1"}');
  });

  it('seeOther is a 303 to the URL', () => {
    const res = seeOther('https://crawlmouse.com/settings/plan?cancel=done');
    expect([res.status, res.headers.get('location')]).toEqual([
      303,
      'https://crawlmouse.com/settings/plan?cancel=done',
    ]);
  });

  it('a refusal is the status and {error}, with any detail after it', async () => {
    const plain = refuse(409, 'plan_held');
    expect([plain.status, await plain.text()]).toEqual([409, '{"error":"plan_held"}']);
    const detailed = refuse(409, 'trial_refused', { reason: 'the account has used its trial' });
    expect(await detailed.text()).toBe(
      '{"error":"trial_refused","reason":"the account has used its trial"}',
    );
  });
});
