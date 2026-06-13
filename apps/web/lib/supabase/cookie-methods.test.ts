import { describe, it, expect } from 'vitest';
import { cookieMethodsFor } from './cookie-methods';

/**
 * Fake of Next 15's awaited `cookies()` store whose `set()` throws exactly the way Next
 * does when a cookie write is attempted during a Server Component render
 * ("Cookies can only be modified in a Server Action or Route Handler."). This is the
 * production crash from CRAWLMOUSE-7/-8: `getUser()` rotates an expired token mid-render,
 * `@supabase/ssr` calls `setAll`, and Next throws.
 */
function renderContextStore() {
  return {
    getAll: () => [{ name: 'sb-access-token', value: 'old' }],
    set() {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
    },
  };
}

describe('cookieMethodsFor', () => {
  it('does not throw when the cookie store rejects writes (Server Component render)', () => {
    const methods = cookieMethodsFor(renderContextStore());
    expect(() =>
      methods.setAll!([{ name: 'sb-access-token', value: 'new', options: {} }], {}),
    ).not.toThrow();
  });

  it('writes every cookie through to the store when writes are allowed', () => {
    const writes: Array<{ name: string; value: string }> = [];
    const methods = cookieMethodsFor({
      getAll: () => [],
      set: (name, value) => {
        writes.push({ name, value });
      },
    });
    methods.setAll!(
      [
        { name: 'a', value: '1', options: {} },
        { name: 'b', value: '2', options: {} },
      ],
      {},
    );
    expect(writes).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);
  });

  it('getAll delegates to the underlying store', () => {
    const cookies = [{ name: 'x', value: 'y' }];
    const methods = cookieMethodsFor({ getAll: () => cookies, set: () => {} });
    expect(methods.getAll()).toEqual(cookies);
  });
});
