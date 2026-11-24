/** RC-01: with public checks on and billing off, /llms.txt describes the v2 pages that are served. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRICING_COPY } from '../v2/copy/pricing';
import { plansLine, v2KeyPages } from './llms-v2';

afterEach(() => vi.unstubAllEnvs());

describe('llms.txt with billing off', () => {
  it('lists /pricing with the page’s own description, and keeps Agency off the plans on sale', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('V2_BILLING', '');
    const pricing = v2KeyPages().find(([, path]) => path === '/pricing')!;
    expect(pricing[2]).toBe(PRICING_COPY.description());
    expect(pricing[2]).toContain('Agency');
    expect(plansLine()).not.toContain('Agency');
    expect(v2KeyPages().map(([, path]) => path)).toContain('/agencies');
  });
});
