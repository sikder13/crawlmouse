/**
 * Canonicalize a URL or bare host into a single domain key.
 *
 * One normalizer used everywhere a domain is a key (rate-limit buckets, domain
 * verification, public reports) so `www.example.com` and `example.com` can never
 * become two different keys — which previously let a caller double the per-domain
 * audit rate limit by toggling the `www.` prefix.
 *
 * Throws if the input can't be parsed as a host.
 */
export function normalizeDomain(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
  return host.replace(/^www\./, '');
}
