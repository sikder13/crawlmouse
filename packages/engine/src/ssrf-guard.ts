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
 * Returns true for IPs that must not be reached from server-side fetches:
 * - RFC 1918 private (10/8, 172.16/12, 192.168/16)
 * - Loopback (127/8, ::1)
 * - Link-local (169.254/16, fe80::/10) — includes cloud metadata 169.254.169.254
 * - Unspecified (0.0.0.0, ::)
 * - IPv6 ULA (fc00::/7)
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return true; // not a valid IP — treat as reserved

  if (family === 4) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets as [number, number, number, number];
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // 10/8
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;        // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true;        // 192.168/16
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80')) return true;        // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
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
