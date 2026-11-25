/**
 * CRAWLMOUSE-S: the in-app-browser hosts Sentry is told to drop CSP reports for. Each is a bare host,
 * none is a host our own policy allows (so the list cannot hide a report about something we load),
 * and the ops document that the owner copies them from names every one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { securityHeaders } from './headers.mjs';
import { CSP_IGNORED_SOURCES } from './csp-ignored-sources';

const BASELINE = resolve(__dirname, '../../../../docs/ops/security-baseline.md');

/** Every host named by every CSP header the app sends, dev and production, with Sentry and without. */
function policyHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const dev of [false, true]) {
    for (const sentryDsn of [undefined, 'https://abc123@o42.ingest.us.sentry.io/4507']) {
      const entries = securityHeaders({
        sentryDsn,
        supabaseUrl: 'https://abcdefgh.supabase.co',
        posthogHost: 'https://us.i.posthog.com',
        dev,
      });
      for (const { headers } of entries) {
        for (const { key, value } of headers) {
          if (!/content-security-policy/i.test(key)) continue;
          for (const m of value.matchAll(
            /(?:https?:\/\/|wss?:\/\/)?((?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi,
          )) {
            hosts.add(m[1]!.toLowerCase());
          }
        }
      }
    }
  }
  return hosts;
}

/** Whether a policy host covers `host`: the same host, or a `*.` wildcard over it. */
const covers = (policyHost: string, host: string) =>
  policyHost === host ||
  (policyHost.startsWith('*.') && host.endsWith(policyHost.slice(1))) ||
  host.endsWith(`.${policyHost}`);

describe('CSP reports Sentry drops for in-app-browser hosts (CRAWLMOUSE-S)', () => {
  it('lists bare hosts, with no scheme, path or wildcard', () => {
    expect(CSP_IGNORED_SOURCES.length).toBeGreaterThan(0);
    for (const host of CSP_IGNORED_SOURCES) expect(host).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
  });

  it('reads the hosts the policy allows: Stripe and Turnstile are among them', () => {
    const hosts = policyHosts();
    expect([...hosts].some((h) => covers(h, 'checkout.stripe.com'))).toBe(true);
    expect([...hosts].some((h) => covers(h, 'challenges.cloudflare.com'))).toBe(true);
  });

  it('names no host the policy allows, so it cannot hide a report about something we load', () => {
    const hosts = [...policyHosts()];
    for (const ignored of CSP_IGNORED_SOURCES) {
      expect(
        hosts.filter((h) => covers(h, ignored) || covers(ignored, h)),
        ignored,
      ).toEqual([]);
    }
  });

  it('the ops document the owner copies from names every entry', () => {
    const doc = readFileSync(BASELINE, 'utf8');
    for (const host of CSP_IGNORED_SOURCES) expect(doc).toContain(`\`${host}\``);
  });
});
