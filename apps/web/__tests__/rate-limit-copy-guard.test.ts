import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOMAIN_AUDITS_PER_HOUR } from '../lib/limits';

// The per-domain free/anon rate limit is DOMAIN_AUDITS_PER_HOUR = 1 over a one-HOUR window (enforced
// in app/api/audits/start/route.ts; the 429 says "Another audit for this domain ran in the last
// hour"). The user-facing copy must describe that same window — it had drifted to "per 24h", which
// contradicted the actual limit. Pin the copy to the enforced window so the two can't silently
// diverge again.
const FILES = [
  resolve(__dirname, '..', 'components/audit/UrlForm.tsx'),
  resolve(__dirname, '..', 'components/billing/PricingCards.tsx'),
];

describe('per-domain rate-limit copy matches the enforced window', () => {
  it('the enforced limit is 1 per hour', () => {
    expect(DOMAIN_AUDITS_PER_HOUR).toBe(1);
  });

  for (const file of FILES) {
    const name = file.split('/').slice(-1)[0];
    it(`${name} describes the per-hour domain limit and never the stale 24h/day phrasing`, () => {
      const src = readFileSync(file, 'utf8');
      expect(/per\s+hour/i.test(src), 'must describe the per-hour domain limit').toBe(true);
      expect(
        /24\s*-?\s*h(?:ours?)?|per\s+24|per\s+day|\bdaily\b/i.test(src),
        'must not use stale daily / 24h copy that contradicts the 1/hour limit',
      ).toBe(false);
    });
  }
});
