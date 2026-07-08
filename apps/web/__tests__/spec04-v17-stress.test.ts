import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINT_REPORTS_PER_IP_PER_DAY_ANON, MINT_REPORTS_PER_DAY, GLOBAL_AUDITS_PER_DAY } from '@/lib/limits';

// SPEC 04 §11 (V17) — a scripted burst of anon mints + OG fetches must not blow the <=18%-MRR envelope.
// The full k6 flood is staging-deferred (like tests/load), and the mint burst -> Turnstile gate is
// exercised behaviorally in app/api/reports/mint/route.test.ts (cap exhausted -> captcha_required ->
// no insert). This locks the cost-control INVARIANTS that make the flood safe. FAILS LOUD on a rename.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('mint/OG flood cost controls (§11, V17)', () => {
  it('anon minting is per-IP capped + bounded, escalating to Turnstile at the cap', () => {
    expect(MINT_REPORTS_PER_IP_PER_DAY_ANON).toBeGreaterThan(0);
    expect(MINT_REPORTS_PER_IP_PER_DAY_ANON).toBeLessThanOrEqual(MINT_REPORTS_PER_DAY); // anon <= authed
    expect(MINT_REPORTS_PER_DAY).toBeLessThanOrEqual(50); // no unbounded mint budget
    const mint = read('app/api/reports/mint/route.ts');
    expect(mint).toContain('MINT_REPORTS_PER_IP_PER_DAY_ANON'); // anon cap enforced
    expect(mint).toContain('captcha_required'); // Turnstile escalates once the cap is exhausted
  });

  it('the global:audits:day ceiling stays fail-CLOSED (Stage E adds no new uncapped audit path)', () => {
    expect(GLOBAL_AUDITS_PER_DAY).toBeGreaterThan(0);
    const start = read('app/api/audits/start/route.ts');
    expect(start).toContain("checkRateLimit('global:audits:day'");
    expect(start).toContain('failClosed: true'); // a Supabase blip denies rather than uncapping spend
  });

  it('the OG card is CDN-cached + slug-scoped, so an unfurl flood is absorbed (never a re-render bomb)', () => {
    const og = read('app/r/[slug]/opengraph-image.tsx');
    expect(og).toMatch(/revalidate\s*=\s*3600/); // repeated unfurls hit the CDN, not satori
    expect(og).toContain('getPublicReport(slug)'); // slug-scoped — cannot render arbitrary images
  });
});
