import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertPlainHost, hasPlainHost, HostnameRefusedError, isPlainHost } from './hostname.js';

// Not `xn--`: the parser reads such a label as punycode and refuses it once a character is inserted.
const label = fc
  .stringMatching(/^[a-z0-9]([a-z0-9-]{0,20}[a-z0-9])?$/)
  .filter((l) => !/^..--/.test(l));
const name = fc.array(label, { minLength: 1, maxLength: 4 }).map((ls) => [...ls, 'com'].join('.'));
/** The characters inbox 054 names. */
const NAMED = ['{', '}', '*', '?', '[', ']', '(', ')', '!', '+', '@', ','] as const;
/** Of those, the ones the URL parser keeps in a hostname (measured with Node 22 on 2026-11-24). */
const KEPT_BY_PARSER = ['{', '}', '*', '(', ')', '!', '+', ','] as const;

/** `c`, `times` times, at position `at` of `host`. */
const insert = (host: string, c: string, at: number, times: number) => {
  const i = at % (host.length + 1);
  return host.slice(0, i) + c.repeat(times) + host.slice(i);
};

describe('isPlainHost', () => {
  it.each(NAMED)('refuses a hostname with %s in it, wherever it falls', (c) => {
    fc.assert(
      fc.property(name, fc.nat(), fc.integer({ min: 1, max: 4 }), (host, at, times) => {
        expect(isPlainHost(insert(host, c, at, times))).toBe(false);
      }),
    );
  });

  it('refuses brackets around anything but an IPv6 address', () => {
    for (const h of ['[{a,b}]', '[*]', '[a.com]', '[]', '[::1', '::1]']) {
      expect(isPlainHost(h), h).toBe(false);
    }
  });

  it('passes generated ordinary hostnames, IPv4 addresses and IPv6 literals', () => {
    fc.assert(
      fc.property(name, (host) => {
        expect(isPlainHost(host)).toBe(true);
      }),
    );
    for (const h of ['1.2.3.4', '[::1]', '[2001:db8::1]', 'example.com.']) {
      expect(isPlainHost(h), h).toBe(true);
    }
  });
});

describe('hasPlainHost, on a URL', () => {
  it('passes ordinary URLs, in any case, with or without a port, path or trailing dot', () => {
    fc.assert(
      fc.property(
        name,
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom('', ':8080', '/a/b?c=1#d', '.'),
        (host, upper, https, tail) => {
          const h = upper ? host.toUpperCase() : host;
          expect(hasPlainHost(`${https ? 'https' : 'http'}://${h}${tail}`)).toBe(true);
        },
      ),
    );
  });

  it('passes internationalised hostnames, which the parser puts in punycode', () => {
    for (const h of ['bücher.de', 'пример.рф', '日本語.jp', 'españa.es', 'straße.de']) {
      expect(hasPlainHost(`https://${h}/`), h).toBe(true);
    }
  });

  it.each(KEPT_BY_PARSER)('refuses a URL whose host has %s, which the parser keeps', (c) => {
    fc.assert(
      fc.property(name, fc.nat(), fc.integer({ min: 1, max: 4 }), (host, at, times) => {
        const url = `http://${insert(host, c, at, times)}/`;
        expect(new URL(url).hostname).toContain(c);
        expect(hasPlainHost(url)).toBe(false);
      }),
    );
  });

  it('leaves none of ? @ [ ] in a hostname: the parser reads them as delimiters, or refuses', () => {
    fc.assert(
      fc.property(name, fc.constantFrom('?', '@', '[', ']'), fc.nat(), (host, c, at) => {
        let hostname: string | null = null;
        try {
          hostname = new URL(`http://${insert(host, c, at, 1)}/`).hostname;
        } catch {
          return;
        }
        expect(hostname).not.toMatch(/[?@]|\[(?![0-9a-f:.]+\]$)/);
      }),
    );
  });

  it('refuses the brace groups of GHSA-g3hv-75wg-m249, an underscore, and what does not parse', () => {
    const url = 'http://{a,b}{c,d}{e,f}.example.com/';
    expect(new URL(url).hostname).toContain('{');
    expect(hasPlainHost(url)).toBe(false);
    expect(() => assertPlainHost(url)).toThrow(HostnameRefusedError);
    expect(hasPlainHost('http://my_site.example.com/')).toBe(false);
    expect(hasPlainHost('not a url')).toBe(false);
  });
});
