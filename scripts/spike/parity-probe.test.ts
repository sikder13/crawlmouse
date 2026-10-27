import { describe, it, expect } from 'vitest';
import { siteDiffers, IDENTITIES } from './parity-probe.js';

describe('parity probe comparison', () => {
  it('covers the browser control, our UA, the tagged Googlebot and the six tokens', () => {
    expect(IDENTITIES).toHaveLength(9);
    expect(new Set(IDENTITIES).size).toBe(9);
  });
  it('a site differs when any identity classifies differently between clients', () => {
    expect(siteDiffers([{ safeFetch: 'served', comparison: 'served' }])).toBe(false);
    expect(siteDiffers([{ safeFetch: 'served', comparison: 'served' }, { safeFetch: 'refused', comparison: 'served' }])).toBe(true);
  });
});
