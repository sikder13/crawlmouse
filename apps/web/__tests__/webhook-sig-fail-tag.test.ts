import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-text backstop for the Stripe-webhook signature-failure signal (TC-L9). The tagged Sentry
// warning + the 400/500 statuses live in route code (not a pure helper) and the live Sentry sink
// may be unqueryable in CI, so pin the exact tag string + statuses + bodies from source. Comments
// are stripped first so a weakened real call hidden behind a comment cannot satisfy the assertion.
const FILE = resolve(__dirname, '..', 'app/api/webhooks/stripe/route.ts');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (avoid eating `://`)
}

const source = stripComments(readFileSync(FILE, 'utf8'));

describe('stripe webhook signature-failure signal', () => {
  it('emits the tagged low-noise Sentry warning on a bad signature', () => {
    expect(source).toContain("Sentry.captureMessage('stripe.webhook.signature_failed'");
    expect(source).toContain("level: 'warning'");
    expect(source).toContain("signal: 'stripe-webhook-sig-fail'");
  });

  it('returns 400 invalid signature, and 500 server misconfigured when the secret is unset', () => {
    expect(source).toContain("new Response('invalid signature', { status: 400 })");
    expect(source).toContain("new Response('server misconfigured', { status: 500 })");
  });
});
