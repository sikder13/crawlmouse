import { promises as dns } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import net from 'node:net';
import type { LookupFunction } from 'node:net';
import { isReservedAddress, parseAddress } from './address-ranges.js';

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
 * True for an address a server-side fetch must not reach, and for text that is not an address.
 *
 * The text is read into its 4 or 16 bytes once, and the verdict comes from the bytes and the table
 * in address-ranges.ts (private, loopback, link local, documentation, multicast, reserved, and the
 * IPv6 prefixes that carry an IPv4 address, which are judged by the address they carry). The text is
 * refused when Node's `net.isIP` does not read it as an address or when `parseAddress` does not, and
 * an IPv6 address with a zone (`fe80::1%eth0`) is refused whatever its bytes.
 *
 * The two readers accept the same text (ssrf-guard.property.test.ts checks that they agree), so
 * either check alone decides the same; both are kept so that a defect in one is not the guard's.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIP(ip) === 0) return true;
  const address = parseAddress(ip);
  if (address === null) return true;
  if (address.zone !== null) return true;
  return isReservedAddress(address.family, address.bytes);
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
    const opts: LookupOptions = typeof options === 'number' ? { family: options } : (options ?? {});
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
              new Error(
                `Blocked connection to private or reserved IP (${addr}) for ${host}`,
              ) as NodeJS.ErrnoException,
              '',
            );
            return;
          }
        }
        const requested = typeof opts.family === 'number' ? opts.family : 0;
        const pool = requested ? addresses.filter((a) => net.isIP(a) === requested) : addresses;
        const chosen = pool.length ? pool : addresses;
        if (opts.all) {
          callback(
            null,
            chosen.map((address) => ({ address, family: net.isIP(address) })),
          );
        } else {
          const address = chosen[0]!;
          callback(null, address, net.isIP(address));
        }
      })
      .catch((err: unknown) => callback(err as NodeJS.ErrnoException, ''));
  };
  return lookup as LookupFunction;
}
