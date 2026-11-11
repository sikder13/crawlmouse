import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureServerEvent } from './server-capture-interim';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('captureServerEvent (interim)', () => {
  it('gives up on a send that hangs, so the action it records is not held', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'test-key');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal = init.signal ?? undefined;
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const started = Date.now();
    await expect(captureServerEvent('site_added', 'account:a', { n: 1 })).resolves.toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10_000);

  it('sends nothing without a project key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await captureServerEvent('site_added', 'account:a', { n: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
