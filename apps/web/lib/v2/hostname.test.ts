import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkHost } from './hostname';

describe('checking the address typed on Home', () => {
  it('accepts a domain, with or without scheme, path, port, query or a trailing dot', () => {
    for (const input of [
      'example.com',
      ' Example.COM ',
      'https://example.com',
      'http://www.example.com/path?q=1#x',
      'example.com:8443/a',
      'example.com.',
      'shop.example.co.uk',
    ]) {
      const r = checkHost(input);
      expect(r.ok, input).toBe(true);
    }
    expect(checkHost('HTTPS://Shop.Example.com/x')).toEqual({ ok: true, host: 'shop.example.com' });
  });

  it('turns an internationalised domain into the name a crawler requests', () => {
    expect(checkHost('bücher.example')).toEqual({ ok: true, host: 'xn--bcher-kva.example' });
  });

  it('asks for an address when nothing was typed', () => {
    expect(checkHost('   ')).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('refuses an IP address, localhost, a single name and another scheme, each with its own reason', () => {
    expect(checkHost('192.168.0.1')).toMatchObject({ ok: false, reason: 'ip' });
    expect(checkHost('http://[::1]/')).toMatchObject({ ok: false, reason: 'ip' });
    expect(checkHost('localhost')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkHost('intranet')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkHost('ftp://example.com')).toMatchObject({ ok: false, reason: 'scheme' });
    expect(checkHost('exa mple.com')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkHost('-bad.example.com')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkHost('example.c0m')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('gives every refusal a message to show beside the field', () => {
    for (const input of ['', '10.0.0.1', 'localhost', 'mailto:x@example.com']) {
      const r = checkHost(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
    }
  });

  it('accepts any generated domain and returns it lower-cased (property)', () => {
    fc.assert(
      fc.property(
        fc.domain(),
        fc.constantFrom('', 'https://', 'http://'),
        fc.webPath(),
        (d, scheme, path) => {
          if (!/\.[a-z]{2,}$/i.test(d)) return true;
          const r = checkHost(`${scheme}${d}${scheme ? path : ''}`);
          return r.ok && r.host === new URL(`https://${d}`).hostname;
        },
      ),
    );
  });

  it('refuses any IPv4 address (property)', () => {
    fc.assert(fc.property(fc.ipV4(), (ip) => checkHost(ip).ok === false));
  });
});
