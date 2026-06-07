import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source guard for the geo-gated analytics-consent wiring. Like replay-privacy.test.ts and
// load-harness-guard.test.ts, these modules run/initialize at import time (PostHog init, Next
// middleware/edge) or are client components that the project does not exercise in a jsdom env, so
// we pin the load-bearing wiring from source. Comments are stripped first so a weakened real line
// hidden behind a reassuring comment cannot satisfy an assertion. The pure decision logic itself
// is unit-tested in lib/consent.test.ts; this guard pins that the wiring actually USES it.

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function read(rel: string): string {
  return stripComments(readFileSync(resolve(__dirname, '..', rel), 'utf8'));
}

describe('instrumentation-client gates PostHog on consent', () => {
  const src = read('instrumentation-client.ts');

  it('derives the opt-out default from the consent cookie + stored decision', () => {
    expect(src).toContain('consentRequiredFromCookie(document.cookie)');
    expect(src).toContain('CONSENT_DECISION_STORAGE_KEY');
    // The opt-out default must be load-bearing: required region AND not yet granted.
    expect(src).toMatch(/optOutByDefault\s*=\s*consentRequired\s*&&\s*decision\s*!==\s*'granted'/);
  });

  it('passes opt_out_capturing_by_default into posthog.init (not a hardcoded false)', () => {
    expect(src).toContain('opt_out_capturing_by_default: optOutByDefault');
    expect(src).not.toContain('opt_out_capturing_by_default: false');
  });

  it('never records replay for opted-out (pre-consent) visitors', () => {
    expect(src).toContain('has_opted_out_capturing');
    // the guard must short-circuit BEFORE startSessionRecording
    expect(src).toMatch(/has_opted_out_capturing\?\.\(\)\)\s*return;[\s\S]*startSessionRecording\(/);
  });
});

describe('middleware sets the consent-required cookie from geo', () => {
  const src = read('middleware.ts');

  it('reads the visitor country and writes the consent-required flag cookie', () => {
    expect(src).toContain("req.headers.get('x-vercel-ip-country')");
    expect(src).toContain('isConsentRequiredCountry(country)');
    expect(src).toContain('CONSENT_REQUIRED_COOKIE');
    expect(src).toContain('res.cookies.set');
  });

  it('maps a consent-required country to "1" and others to "0" (not inverted)', () => {
    // An inverted ternary would flag EU/EEA/UK as "0" -> PostHog captures WITHOUT consent (the exact
    // GDPR violation this feature prevents). Pin the exact direction.
    expect(src).toMatch(/isConsentRequiredCountry\(country\)\s*\?\s*'1'\s*:\s*'0'/);
  });

  it('runs on page routes (matcher broadened beyond just /r/ and /embed/)', () => {
    // Must match generic pages so the cookie is set before the client loads; excludes api/ingest.
    expect(src).toMatch(/matcher:\s*\[\s*'\/\(\(\?!api\|ingest/);
  });
});

describe('CookieConsent banner is wired correctly', () => {
  const src = read('components/consent/CookieConsent.tsx');

  it('is a client component using the pure decision helper', () => {
    expect(src).toContain("'use client'");
    expect(src).toContain('shouldShowConsentBanner(document.cookie');
    expect(src).toContain('CONSENT_DECISION_STORAGE_KEY');
  });

  it('opts in on allow, opts out on decline, and records the decision', () => {
    expect(src).toContain('posthog.opt_in_capturing()');
    expect(src).toContain('posthog.opt_out_capturing()');
    expect(src).toContain('localStorage.setItem(CONSENT_DECISION_STORAGE_KEY');
    expect(src).toMatch(/granted\s*\?\s*'granted'\s*:\s*'denied'/);
  });

  it('renders an accessible dialog linking to the Privacy Policy', () => {
    expect(src).toContain('role="dialog"');
    expect(src).toContain('href="/privacy"');
  });

  it('is mounted in the root layout', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain('CookieConsent');
    expect(layout).toContain('<CookieConsent />');
  });
});

describe('consent can be withdrawn/changed (GDPR Art. 7(3))', () => {
  it('the banner re-opens on the consent-open event so a prior decision can be changed', () => {
    const src = read('components/consent/CookieConsent.tsx');
    expect(src).toContain('CONSENT_OPEN_EVENT');
    expect(src).toMatch(/addEventListener\(\s*CONSENT_OPEN_EVENT/);
  });

  it('a persistent "Cookie settings" control dispatches the re-open event', () => {
    const src = read('components/consent/CookieSettingsButton.tsx');
    expect(src).toContain("'use client'");
    expect(src).toContain('CONSENT_OPEN_EVENT');
    expect(src).toMatch(/dispatchEvent\(/);
  });

  it('the footer exposes the Cookie settings control on every page', () => {
    const footer = read('components/layout/Footer.tsx');
    // Pin the actual JSX render (not just the import), so deleting the control fails the guard on
    // its own rather than relying on the lint no-unused-vars backstop.
    expect(footer).toMatch(/<CookieSettingsButton\s*\/>/);
  });
});

describe('Privacy Policy describes the consent gate truthfully', () => {
  const src = read('app/privacy/page.tsx');
  it('states analytics are held until consent for EU/EEA/UK visitors', () => {
    const lower = src.toLowerCase().replace(/\s+/g, ' ');
    expect(lower).toContain('eu/eea and uk');
    expect(lower).toContain('consent');
    expect(lower).toContain('before loading');
  });
});
