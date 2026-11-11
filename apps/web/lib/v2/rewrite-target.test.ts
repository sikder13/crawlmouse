import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => h.headers }));

import { REWRITE_HEADER } from './rewrites';
import { reachedByRewrite } from './rewrite-target';

afterEach(() => {
  h.headers = new Headers();
});

describe('reachedByRewrite', () => {
  it('is true only when the middleware marked the request as its rewrite', async () => {
    h.headers = new Headers({ [REWRITE_HEADER]: '1' });
    expect(await reachedByRewrite()).toBe(true);
  });

  it.each([
    ['no marker', {}],
    ['another value', { [REWRITE_HEADER]: 'true' }],
    ['an empty one', { [REWRITE_HEADER]: '' }],
  ])('is false with %s', async (_name, init) => {
    h.headers = new Headers(init as Record<string, string>);
    expect(await reachedByRewrite()).toBe(false);
  });
});
