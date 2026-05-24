import { promises as dns } from 'node:dns';
import net from 'node:net';

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

  const resolver = opts.resolver ?? defaultResolver;
  const addresses = await resolver(url.hostname);
  if (addresses.length === 0) {
    throw new Error(`DNS resolution failed for ${url.hostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr)) {
      throw new Error(`URL resolves to private or reserved IP (${addr}): ${url.toString()}`);
    }
  }

  return url;
}
