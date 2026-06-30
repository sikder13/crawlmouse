import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOMAIN_AUDITS_PER_HOUR } from '../lib/limits';

// The per-domain free/anon rate limit is DOMAIN_AUDITS_PER_HOUR over a one-HOUR window (enforced in
// app/api/audits/start/route.ts; the 429 says "Another audit for this domain ran in the last hour").
// The user-facing copy must describe that same WINDOW (per-hour, never "per day"/"24h") so the count
// can be tuned without the copy silently drifting to a contradictory window. (The count was raised
// 1→5 so a user can re-check their own site within the hour — the freemium loop.)
const FILES = [
  resolve(__dirname, '..', 'components/audit/UrlForm.tsx'),
  resolve(__dirname, '..', 'components/billing/PricingCards.tsx'),
];

describe('per-domain rate-limit copy matches the enforced window', () => {
  it('the enforced limit is 5 per hour', () => {
    expect(DOMAIN_AUDITS_PER_HOUR).toBe(5);
  });

  for (const file of FILES) {
    const name = file.split('/').slice(-1)[0];
    it(`${name} describes the per-hour domain limit and never the stale 24h/day phrasing`, () => {
      const src = readFileSync(file, 'utf8');
      expect(/per\s+hour/i.test(src), 'must describe the per-hour domain limit').toBe(true);
      expect(
        /24\s*-?\s*h(?:ours?)?|per\s+24|per\s+day|\bdaily\b/i.test(src),
        'must not use stale daily / 24h copy that contradicts the hourly limit',
      ).toBe(false);
      // Pin the COUNT, not just the window. Qualitative copy ("a few") is allowed (no digit), but any
      // explicit "<n> audits … per hour" claim MUST equal DOMAIN_AUDITS_PER_HOUR — otherwise a stale
      // number drifts silently. (This is the gap that let "1 audit per domain, per hour" ship against
      // an enforced limit of 5: the old guard checked only the window word.)
      const claims = [...src.matchAll(/(\d+)\s+audits?\b[^.]{0,40}?per\s+hour/gi)].map((m) => Number(m[1]));
      for (const n of claims) {
        expect(
          n,
          `a displayed "${n} audits … per hour" claim must equal DOMAIN_AUDITS_PER_HOUR (${DOMAIN_AUDITS_PER_HOUR})`,
        ).toBe(DOMAIN_AUDITS_PER_HOUR);
      }
    });
  }
});
