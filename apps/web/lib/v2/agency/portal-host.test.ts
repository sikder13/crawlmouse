import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isShareToken } from '../reports/share';
import {
  hostnameOf,
  isOwnHost,
  normalizeHost,
  OWN_HOST_MATCHER,
  portalHostRefusal,
  portalPathAllowed,
} from './portal-host';

/** A lower-case LDH label of 1 to `max` characters. */
const label = (max = 20) =>
  fc
    .stringMatching(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .filter((l) => l.length <= max && !l.startsWith('xn--'));

/** Registrable domains under suffixes of each ICANN shape: one label, two labels, a ccTLD. */
const ICANN_SUFFIXES = ['com', 'org', 'net', 'io', 'co.uk', 'com.au', 'de', 'agency'] as const;
const registrable = fc
  .tuple(label(), fc.constantFrom(...ICANN_SUFFIXES))
  .map(([l, s]) => `${l}.${s}`)
  .filter((d) => !/^(crawlmouse|nahltech|vercel-dns(-\d+)?)\./.test(d));

describe('portalHostRefusal: what an agency may attach (row 25 c)', () => {
  it('takes any host one or more labels below an ICANN registrable domain', () => {
    fc.assert(
      fc.property(fc.array(label(), { minLength: 1, maxLength: 3 }), registrable, (subs, d) => {
        const host = `${subs.join('.')}.${d}`;
        fc.pre(host.length <= 253);
        expect(portalHostRefusal(host)).toBeNull();
      }),
    );
  });

  it('refuses the registrable domain itself (an apex cannot carry the CNAME)', () => {
    fc.assert(
      fc.property(registrable, (d) => {
        expect(portalHostRefusal(d)).toBe('apex');
      }),
    );
  });

  it('refuses a public suffix typed as a host, one label or two', () => {
    for (const s of ICANN_SUFFIXES) {
      expect(portalHostRefusal(s)).toBe(s.includes('.') ? 'public_suffix' : 'single_label');
    }
  });

  it('refuses a host under a private-section suffix (a platform, not the agency)', () => {
    for (const p of ['github.io', 'netlify.app', 'pages.dev', 'herokuapp.com']) {
      expect(portalHostRefusal(`reports.someone.${p}`)).toBe('unknown_suffix');
    }
  });

  it('refuses every host under our domains and Vercel’s, at any depth', () => {
    const ours = [
      'crawlmouse.com',
      'nahltech.com',
      'vercel.com',
      'vercel-dns.com',
      'vercel-dns-017.com',
    ];
    fc.assert(
      fc.property(
        fc.array(label(), { minLength: 1, maxLength: 3 }),
        fc.constantFrom(...ours),
        (subs, d) => {
          expect(portalHostRefusal(`${subs.join('.')}.${d}`)).toBe('ours');
        },
      ),
    );
    // vercel.app, vercel.sh and now.sh are private-section suffixes: refused before the list is read.
    for (const d of ['vercel.app', 'now.sh', 'vercel.sh']) {
      expect(portalHostRefusal(`a.b.${d}`)).not.toBeNull();
    }
  });

  it('refuses a special-use or unlisted top-level name, ICANN-listed ones included', () => {
    for (const tld of [
      'local',
      'localhost',
      'test',
      'example',
      'invalid',
      'internal',
      'onion',
      'arpa',
    ]) {
      expect(portalHostRefusal(`reports.agency.${tld}`)).toBe('reserved');
    }
    for (const tld of ['lan', 'corp', 'home', 'zzzz']) {
      expect(portalHostRefusal(`reports.agency.${tld}`)).toBe('unknown_suffix');
    }
  });

  it('refuses an IP literal, v4 or v6, bracketed or not', () => {
    fc.assert(
      fc.property(fc.ipV4(), (ip) => {
        expect(portalHostRefusal(ip)).toBe('ip');
      }),
    );
    fc.assert(
      fc.property(fc.ipV6(), (ip) => {
        expect(portalHostRefusal(ip)).toBe('ip');
        expect(portalHostRefusal(`[${ip}]`)).toBe('ip');
      }),
    );
  });

  it('refuses a single label', () => {
    fc.assert(
      fc.property(label(), (l) => {
        expect(portalHostRefusal(l)).not.toBeNull();
      }),
    );
  });

  it('refuses a host past 253 characters, and takes one of exactly 253', () => {
    const at = (n: number) => {
      const tail = '.agency.com';
      let host = '';
      while (host.length + tail.length < n) host += host.length === 0 ? 'a' : '.a';
      return (host + tail).slice(-n).replace(/^\./, 'a');
    };
    const ok = at(253);
    expect(ok.length).toBe(253);
    expect(portalHostRefusal(ok)).toBeNull();
    expect(portalHostRefusal(`a${ok}`)).toBe('too_long');
  });

  it('refuses any label that is empty, over 63, or not letters, digits and inner hyphens', () => {
    const bad = ['', '-a', 'a-', 'a_b', 'a b', 'a*', 'a'.repeat(64), 'a/b', 'a@b'];
    for (const l of bad) expect(portalHostRefusal(`${l}.agency.com`)).not.toBeNull();
    expect(portalHostRefusal(`${'a'.repeat(63)}.agency.com`)).toBeNull();
  });

  it('refuses any non-ASCII host and any punycode label (no IDN in v1, so no mixed scripts)', () => {
    expect(portalHostRefusal('reports.аgency.com')).toBe('not_ascii'); // Cyrillic а
    expect(portalHostRefusal('reports.agency.рф')).toBe('not_ascii');
    expect(portalHostRefusal('reports.xn--80ak6aa92e.com')).toBe('idn');
    expect(portalHostRefusal('reports.agency.xn--p1ai')).toBe('idn');
  });

  it('normalises case, surrounding space and one trailing dot before any rule', () => {
    expect(normalizeHost('  Reports.Agency.COM. ')).toBe('reports.agency.com');
    expect(portalHostRefusal('Reports.Agency.COM.')).toBeNull();
    expect(portalHostRefusal('reports.agency.com..')).toBe('bad_label');
    expect(portalHostRefusal('   ')).toBe('empty');
  });
});

describe('isOwnHost: the hosts served as crawlmouse.com', () => {
  it('is ours: the apex, its subdomains, Vercel deployment addresses, local, with or without a port', () => {
    for (const h of [
      'crawlmouse.com',
      'www.crawlmouse.com',
      'a.lab.crawlmouse.com',
      'crawlmouse-001.vercel.app',
      'crawlmouse-git-x-team.vercel.app',
      'localhost:3000',
      '127.0.0.1:3000',
      '[::1]:3000',
      'CRAWLMOUSE.COM',
      'crawlmouse.com.',
    ]) {
      expect(isOwnHost(h), h).toBe(true);
    }
  });

  it('is not ours: any host a portal can be, and look-alikes of ours', () => {
    for (const h of [
      'reports.agency.com',
      'crawlmouse.com.evil.com',
      'evilcrawlmouse.com',
      'crawlmouse.co',
      'vercel.app.evil.com',
      'x.vercel.app.evil.com',
    ]) {
      expect(isOwnHost(h), h).toBe(false);
    }
  });

  it('agrees with OWN_HOST_MATCHER as Next applies it (anchored, on the port-less name)', () => {
    const re = new RegExp(`^${OWN_HOST_MATCHER}$`);
    const hosts = fc.oneof(
      fc.domain(),
      fc.domain().map((d) => `${d}.crawlmouse.com`),
      fc.domain().map((d) => `${d}.vercel.app`),
      fc.constantFrom(
        'crawlmouse.com',
        'localhost',
        '127.0.0.1',
        'vercel.app',
        'crawlmouse.com.x.io',
      ),
    );
    fc.assert(
      fc.property(hosts, (h) => {
        expect(re.test(hostnameOf(h))).toBe(isOwnHost(h));
      }),
    );
  });

  it('no host an agency may attach is ever ours (the two rules cannot overlap)', () => {
    fc.assert(
      fc.property(fc.domain(), (h) => {
        if (portalHostRefusal(h) === null) expect(isOwnHost(h)).toBe(false);
      }),
    );
  });
});

describe('portalPathAllowed: what a portal host may reach (row 25 a)', () => {
  const token = fc.stringMatching(/^[A-Za-z0-9_-]{22}$/);
  const uuid = fc.uuid();

  it('takes a GET or HEAD of a share link, of the page it opens, and of Next’s static files', () => {
    fc.assert(
      fc.property(token, uuid, fc.constantFrom('GET', 'HEAD'), (t, id, m) => {
        expect(portalPathAllowed(m, `/s/${t}`)).toBe(true);
        expect(portalPathAllowed(m, `/s/view/${id}`)).toBe(true);
        expect(portalPathAllowed(m, '/_next/static/chunks/app.js')).toBe(true);
      }),
    );
  });

  it('refuses every other method on those same paths', () => {
    fc.assert(
      fc.property(token, fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'), (t, m) => {
        expect(portalPathAllowed(m, `/s/${t}`)).toBe(false);
      }),
    );
  });

  it('takes a share path exactly when the share module takes its token', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (t) => {
        fc.pre(!t.includes('/') && t !== 'view');
        expect(portalPathAllowed('GET', `/s/${t}`)).toBe(isShareToken(t));
      }),
    );
  });

  it('refuses the paths that must never be reached on a customer’s host', () => {
    for (const p of [
      '/',
      '/dashboard',
      '/login',
      '/verify',
      '/api/agency/brand',
      '/api/auth/magic-link',
      '/api/webhooks/stripe',
      '/ingest/e',
      '/r/some-report',
      '/sitemap.xml',
      '/robots.txt',
      '/s/confirm/abc',
      '/s/view',
      '/s/view/not-a-uuid',
      '/s/view/00000000-0000-0000-0000-000000000000/extra',
      '/_next/image',
      '/_next/data/x.json',
      '/s/AAAAAAAAAAAAAAAAAAAAAA/',
    ]) {
      expect(portalPathAllowed('GET', p), p).toBe(false);
    }
  });
});
