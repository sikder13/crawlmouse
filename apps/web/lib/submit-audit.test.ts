import { describe, it, expect, vi } from 'vitest';
import { submitAuditRequest, shouldAutoResubmit } from './submit-audit';

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response);
}

// The mock is typed with no params, so its recorded call tuple is `[]` — read the RequestInit (2nd arg)
// through `unknown[]` to inspect the JSON body the function actually sent.
function sentBody(f: ReturnType<typeof fetchReturning>): Record<string, unknown> {
  const init = (f.mock.calls[0] as unknown[])[1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe('submitAuditRequest (pure submit + response interpretation)', () => {
  it('200 → navigate with the auditId + domain', async () => {
    const r = await submitAuditRequest('example.com', null, fetchReturning(200, { auditId: 'a1' }));
    expect(r).toEqual({ kind: 'navigate', auditId: 'a1', domain: 'example.com' });
  });

  it('429 captcha_required → captcha (surface the widget, not an error)', async () => {
    const r = await submitAuditRequest('example.com', null, fetchReturning(429, { error: 'captcha_required' }));
    expect(r).toEqual({ kind: 'captcha' });
  });

  it('429 domain limit → error carrying the server message', async () => {
    const msg = 'Another audit for this domain ran in the last hour. Try again soon.';
    const r = await submitAuditRequest('example.com', null, fetchReturning(429, { error: msg }));
    expect(r).toEqual({ kind: 'error', message: msg });
  });

  it('unparseable URL → invalid-url and NO network call', async () => {
    const f = fetchReturning(200, {});
    const r = await submitAuditRequest('not a url with spaces', null, f);
    expect(r).toEqual({ kind: 'invalid-url' });
    expect(f).not.toHaveBeenCalled();
  });

  it('network throw → friendly error', async () => {
    const f = vi.fn(async () => { throw new Error('net'); });
    const r = await submitAuditRequest('example.com', null, f as unknown as typeof fetch);
    expect(r).toEqual({ kind: 'error', message: 'Network error. Please try again.' });
  });

  it('sends the turnstile token in the body when provided (and omits it when null)', async () => {
    const withTok = fetchReturning(200, { auditId: 'a1' });
    await submitAuditRequest('example.com', 'tok-123', withTok);
    expect(sentBody(withTok).turnstileToken).toBe('tok-123');

    const noTok = fetchReturning(200, { auditId: 'a1' });
    await submitAuditRequest('example.com', null, noTok);
    expect(sentBody(noTok).turnstileToken).toBeUndefined();
  });

  it('the retry path that powers auto-resubmit: no-token → captcha, then with-token → navigate', async () => {
    expect(await submitAuditRequest('fresh.example', null, fetchReturning(429, { error: 'captcha_required' }))).toEqual({ kind: 'captcha' });
    expect(await submitAuditRequest('fresh.example', 'tok', fetchReturning(200, { auditId: 'a2' }))).toMatchObject({ kind: 'navigate', auditId: 'a2' });
  });
});

describe('shouldAutoResubmit (the auto-continue gate for the post-captcha token)', () => {
  it('auto-continues when armed, a token arrived, and no submit is in flight', () => {
    expect(shouldAutoResubmit('tok', true, false)).toBe(true);
  });
  it('does NOT auto-continue when not armed (a token without a prior captcha block)', () => {
    expect(shouldAutoResubmit('tok', false, false)).toBe(false);
  });
  it('does NOT auto-continue while a submit is already in flight (no double-submit / re-entrancy loop)', () => {
    expect(shouldAutoResubmit('tok', true, true)).toBe(false);
  });
  it('does NOT auto-continue on a null token (an expire/error that cleared it)', () => {
    expect(shouldAutoResubmit(null, true, false)).toBe(false);
  });
});
