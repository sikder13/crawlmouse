import { describe, it, expect, vi } from 'vitest';
import { subscribeAuthEmail, type AuthStateClient } from './auth-nav-logic';

function mockClient() {
  let cb: ((event: string, session: unknown) => void) | null = null;
  const unsubscribe = vi.fn();
  const sb = {
    auth: {
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        cb = fn;
        return { data: { subscription: { unsubscribe } } };
      },
    },
  } as unknown as AuthStateClient;
  return { sb, emit: (session: unknown) => cb?.('INITIAL_SESSION', session), unsubscribe };
}

describe('subscribeAuthEmail', () => {
  it('maps a session to its email, and to null when signed out', () => {
    const { sb, emit } = mockClient();
    const seen: (string | null)[] = [];
    subscribeAuthEmail(sb, (e) => seen.push(e));
    emit({ user: { email: 'jane@acme.com' } }); // INITIAL_SESSION (signed in)
    emit(null); // SIGNED_OUT
    expect(seen).toEqual(['jane@acme.com', null]);
  });

  it('unsubscribes on cleanup so the listener does not leak', () => {
    const { sb, unsubscribe } = mockClient();
    const cleanup = subscribeAuthEmail(sb, () => {});
    expect(unsubscribe).not.toHaveBeenCalled();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
