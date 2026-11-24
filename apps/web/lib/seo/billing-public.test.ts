/**
 * While paying is kept to the owner (V2_BILLING_ONLY_USER, A1's C5), every public page reads as billing
 * off: no plan is shown on sale to a visitor who cannot buy it (CTO inbox 041).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plansLine } from './llms-v2';

afterEach(() => vi.unstubAllEnvs());

const PUBLIC_READERS = [
  'app/v2-pricing/page.tsx',
  'app/agencies/page.tsx',
  'lib/seo/llms-v2.ts',
  'lib/seo/jsonld.tsx',
];

describe('billing kept to the owner', () => {
  it.each(PUBLIC_READERS)('%s reads billingPublic, not billingV2Enabled', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    expect(src).toContain('billingPublic(');
    expect(src).not.toContain('billingV2Enabled(');
  });

  it('llms.txt lists the same plans as with billing off', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('V2_BILLING', '');
    const off = plansLine();
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('V2_BILLING_ONLY_USER', 'owner-user-id');
    expect(plansLine()).toBe(off);
    vi.stubEnv('V2_BILLING_ONLY_USER', '');
    expect(plansLine()).not.toBe(off);
  });
});
