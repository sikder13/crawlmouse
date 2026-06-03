import { describe, it, expect, vi } from 'vitest';
import { turnstileGate } from './turnstile-gate';

describe('turnstileGate', () => {
  it('allows and never calls verify when the secret is not configured (dev fall-open)', async () => {
    const verify = vi.fn<(token: string) => Promise<boolean>>();
    const outcome = await turnstileGate(false, undefined, verify);
    expect(outcome).toBe('allow');
    expect(verify).not.toHaveBeenCalled();
  });

  it('allows and never calls verify when the secret is unset even if a token is supplied', async () => {
    const verify = vi.fn<(token: string) => Promise<boolean>>();
    const outcome = await turnstileGate(false, 'some-token', verify);
    expect(outcome).toBe('allow');
    expect(verify).not.toHaveBeenCalled();
  });

  it('blocks when the secret is configured but no token is supplied', async () => {
    const verify = vi.fn<(token: string) => Promise<boolean>>();
    const outcome = await turnstileGate(true, undefined, verify);
    expect(outcome).toBe('block');
    expect(verify).not.toHaveBeenCalled();
  });

  it('blocks when the token is an empty string', async () => {
    const verify = vi.fn<(token: string) => Promise<boolean>>();
    const outcome = await turnstileGate(true, '', verify);
    expect(outcome).toBe('block');
    expect(verify).not.toHaveBeenCalled();
  });

  it('allows when configured, a token is supplied, and verify resolves true', async () => {
    const verify = vi.fn<(token: string) => Promise<boolean>>().mockResolvedValue(true);
    const outcome = await turnstileGate(true, 'good-token', verify);
    expect(outcome).toBe('allow');
    expect(verify).toHaveBeenCalledWith('good-token');
  });

  it('blocks when configured, a token is supplied, and verify resolves false', async () => {
    const verify = vi.fn<(token: string) => Promise<boolean>>().mockResolvedValue(false);
    const outcome = await turnstileGate(true, 'bad-token', verify);
    expect(outcome).toBe('block');
    expect(verify).toHaveBeenCalledWith('bad-token');
  });
});
