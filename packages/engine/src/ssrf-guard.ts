import { promises as dns } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

export type DnsResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: DnsResolver = async (hostname) => {
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.map((r) => r.address);
  } catch {
    return [];
  }
};

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Normalize an IPv6 string to its canonical compressed form (e.g., '0:0:0:0:0:0:0:1' -> '::1').
 * Returns the normalized form, or the original string if normalization fails.
 * Uses Node's URL parser which performs RFC 5952 normalization.
 */
function normalizeIPv6(ip: string): string {
  try {
    return new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return ip.toLowerCase();
  }
}

/**
 * Returns true for IPs that must not be reached from server-side fetches:
 * - RFC 1918 private (10/8, 172.16/12, 192.168/16)
 * - Loopback (127/8, ::1)
 * - Link-local (169.254/16, fe80::/10) - includes cloud metadata 169.254.169.254
 * - Unspecified (0.0.0.0, ::)
 * - IPv6 ULA (fc00::/7)
 * - CGNAT (100.64.0.0/10) - includes Alibaba Cloud metadata 100.100.100.200
 * - IPv4-mapped IPv6 (::ffff:a.b.c.d) and IPv4-compatible IPv6 (::a.b.c.d) - recursively checked
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return true; // not a valid IP - treat as reserved

  if (family === 4) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets as [number, number, number, number];
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // 10/8
    if (a === 127) return true;                     // loopback 127/8
    if (a === 169 && b === 254) return true;        // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true;        // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT (Alibaba metadata)
    return false;
  }

  // IPv6 - normalize first so non-canonical forms collapse
  const lower = normalizeIPv6(ip);

  // Loopback (::1) and unspecified (::) after canonical normalization
  if (lower === '::1' || lower === '::') return true;

  // IPv4-mapped IPv6: ::ffff:0:0/96 (dotted-decimal embedded form after normalization)
  // After URL normalization, ::ffff:169.254.169.254 becomes ::ffff:a9fe:a9fe (hex pairs).
  // Match the hex-pair form and extract the embedded v4 address.
  const ipv4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (ipv4MappedHex) {
    const hi = parseInt(ipv4MappedHex[1]!, 16);
    const lo = parseInt(ipv4MappedHex[2]!, 16);
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateOrReservedIp(embedded);
  }
  // Also handle the dotted-decimal form in case normalization preserves it (it usually doesn't, but defensive).
  const ipv4MappedDecimal = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4MappedDecimal) {
    return isPrivateOrReservedIp(ipv4MappedDecimal[1]!);
  }
  // IPv4-compatible (deprecated): ::a.b.c.d or ::aabb:ccdd
  const ipv4CompatDecimal = lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4CompatDecimal) {
    return isPrivateOrReservedIp(ipv4CompatDecimal[1]!);
  }
  const ipv4CompatHex = lower.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (ipv4CompatHex) {
    const hi = parseInt(ipv4CompatHex[1]!, 16);
    const lo = parseInt(ipv4CompatHex[2]!, 16);
    // Only treat as v4-compat if the value looks like a real v4 (avoid false positives on real v6).
    // ::aabb:ccdd as v4-compat would be 0.171.205.221 - we conservatively check.
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (isPrivateOrReservedIp(embedded)) return true;
    // Fall through to other checks if not flagged - this is conservative.
  }

  // NAT64 (64:ff9b::/96) embeds an IPv4 in the low 32 bits, e.g.
  // 64:ff9b::a9fe:a9fe == 169.254.169.254. Reachable on NAT64-enabled (often
  // IPv6-only cloud) networks, so check the embedded v4.
  const nat64 = lower.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (nat64) {
    const hi = parseInt(nat64[1]!, 16);
    const lo = parseInt(nat64[2]!, 16);
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (isPrivateOrReservedIp(embedded)) return true;
  }
  // 6to4 (2002::/16) embeds an IPv4 in the first 32 bits after the prefix, e.g.
  // 2002:a9fe:a9fe:: == 169.254.169.254. Block when the embedded v4 is private.
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1]!, 16);
    const lo = parseInt(sixToFour[2]!, 16);
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (isPrivateOrReservedIp(embedded)) return true;
  }

  // Link-local fe80::/10 - first byte is 0xfe AND second byte is 0x80-0xbf
  const firstByte = parseInt(lower.slice(0, 2), 16);
  const secondByte = parseInt(lower.slice(2, 4), 16);
  if (firstByte === 0xfe && secondByte >= 0x80 && secondByte <= 0xbf) return true;

  // ULA fc00::/7 - first byte 0xfc or 0xfd
  if (firstByte === 0xfc || firstByte === 0xfd) return true;

  return false;
}

export interface ValidateUrlOptions {
  resolver?: DnsResolver;
}

/**
 * Parses, validates scheme, resolves DNS, blocks private IPs.
 * Throws Error with a human-readable message if anything fails.
 */
export async function validateUrlOrThrow(
  input: string,
  opts: ValidateUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(`Disallowed URL scheme: ${url.protocol}`);
  }

  // Reject credentials-in-URL. `http://expected.com@169.254.169.254/` is a classic
  // parser-confusion vector, and userinfo can leak supplied auth to a redirect target.
  if (url.username || url.password) {
    throw new Error(`Credentials in URL are not allowed: ${url.hostname}`);
  }

  // Normalize the host once: strip a single trailing dot (DNS-equivalent but makes
  // `evil.com.` look distinct from `evil.com` to string-based origin checks) and
  // lowercase, so the host we validate is the host every comparison sees.
  const host = url.hostname.replace(/\.$/, '').toLowerCase();

  const resolver = opts.resolver ?? defaultResolver;
  const addresses = await resolver(host);
  if (addresses.length === 0) {
    throw new Error(`DNS resolution failed for ${host}`);
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr)) {
      throw new Error(`URL resolves to private or reserved IP (${addr}): ${url.toString()}`);
    }
  }

  return url;
}

/**
 * Builds a `dns.lookup`-compatible function for use as the `lookup` option of
 * Node's http/https requests (and got, which forwards https.request options).
 * It resolves the hostname, rejects the connection if ANY resolved address is
 * private/reserved, and otherwise returns ONLY the validated addresses — so the
 * socket connects to an address that was checked in the same resolution. This
 * closes the DNS-rebinding / TOCTOU gap where validate-then-connect re-resolves
 * to a different (internal) IP between the check and the connection.
 *
 * Note: Node skips `lookup` entirely for raw IP-literal hosts, so this pins
 * hostname resolution only — raw-IP private targets must still be caught by
 * `validateUrlOrThrow` / per-redirect-hop URL validation.
 */
export function createSafeLookup(resolver: DnsResolver = defaultResolver): LookupFunction {
  const lookup = (
    hostname: string,
    options: LookupOptions | number,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    const opts: LookupOptions = typeof options === 'number' ? { family: options } : options ?? {};
    const host = hostname.replace(/\.$/, '').toLowerCase();
    resolver(host)
      .then((addresses) => {
        if (addresses.length === 0) {
          callback(new Error(`DNS resolution failed for ${host}`) as NodeJS.ErrnoException, '');
          return;
        }
        for (const addr of addresses) {
          if (isPrivateOrReservedIp(addr)) {
            callback(
              new Error(`Blocked connection to private or reserved IP (${addr}) for ${host}`) as NodeJS.ErrnoException,
              '',
            );
            return;
          }
        }
        const requested = typeof opts.family === 'number' ? opts.family : 0;
        const pool = requested ? addresses.filter((a) => net.isIP(a) === requested) : addresses;
        const chosen = pool.length ? pool : addresses;
        if (opts.all) {
          callback(null, chosen.map((address) => ({ address, family: net.isIP(address) })));
        } else {
          const address = chosen[0]!;
          callback(null, address, net.isIP(address));
        }
      })
      .catch((err: unknown) => callback(err as NodeJS.ErrnoException, ''));
  };
  return lookup as LookupFunction;
}
