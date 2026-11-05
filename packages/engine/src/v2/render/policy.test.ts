import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { renderRequestBody } from './client.js';
import { defaultAdmit, NotAdmitted } from './admission.js';
import {
  REJECTED_HOSTS,
  refusingRule,
  URL_RULES,
  wirePattern,
  PATTERNS_SHOWN_LIVE,
} from './policy.js';

const HOSTILE = readFileSync(
  new URL('../../../fixtures/v2/render/hostile-page.html', import.meta.url),
  'utf8',
);

interface Attempt {
  attempt: string;
  url: string;
  resourceType: string | null;
}

/** The requests the hostile fixture page makes, read from the page itself. */
function attempts(): Attempt[] {
  const $ = cheerio.load(HOSTILE);
  return $('[data-attempt]')
    .toArray()
    .map((el) => ({
      attempt: $(el).attr('data-attempt')!,
      url: $(el).attr('data-url')!,
      resourceType: $(el).attr('data-resource-type') ?? null,
    }));
}

/**
 * Whether Browser Run, given the body we send it, refuses a request: read back from the body itself
 * (the patterns as strings, the resource types as listed), so this tests what goes over the wire.
 */
function refusedOnTheWire(body: ReturnType<typeof renderRequestBody>, a: Attempt): boolean {
  const href = new URL(a.url).href;
  // Read as Browser Run was seen to read them live: each string is the expression's source.
  const patterns = body.rejectRequestPattern.map((p) => new RegExp(p));
  const byType = a.resourceType !== null && body.rejectResourceTypes.includes(a.resourceType);
  return byType || patterns.some((re) => re.test(href));
}

/** A resolver that answers with a public address, so a refusal cannot have come from DNS. */
const publicResolver = async () => ['93.184.215.14'];

// Each case is covered by what we send. Browser Run applied the patterns live (PATTERNS_SHOWN_LIVE);
// the WebSocket case is the exception: live, it opened anyway (spec, known limits).
const CASES = ['file', 'metadata', 'mapped-loopback', 'download', 'websocket'] as const;

describe('the hostile fixture page', () => {
  it('makes exactly the five attempts the cases below name', () => {
    expect(attempts().map((a) => a.attempt)).toEqual([...CASES]);
  });

  describe.each(CASES)('its %s attempt', (name) => {
    const a = () => attempts().find((x) => x.attempt === name)!;

    it('is covered by what the rendered side sends Browser Run', () => {
      expect(refusedOnTheWire(renderRequestBody(a().url, 'rendered'), a())).toBe(true);
    });

    it('is covered by what the static side sends Browser Run', () => {
      expect(refusedOnTheWire(renderRequestBody(a().url, 'static'), a())).toBe(true);
    });

    it('is refused as a navigation before any request is sent', async () => {
      await expect(defaultAdmit(publicResolver)(a().url)).rejects.toBeInstanceOf(NotAdmitted);
    });
  });
});

describe('a pattern on the wire', () => {
  it('is the bare regular-expression source, the form the live probe showed applied', () => {
    expect(wirePattern(/^https?:\/\/a\.example(?:[/?#]|$)/)).toBe(
      '^https?:\\/\\/a\\.example(?:[/?#]|$)',
    );
    for (const r of URL_RULES) {
      const wire = wirePattern(r.pattern);
      expect(wire).toBe(r.pattern.source);
      expect(wire.startsWith('/')).toBe(false);
      expect(new RegExp(wire).source).toBe(r.pattern.source);
    }
    expect(PATTERNS_SHOWN_LIVE).toBe('2026-11-05');
  });
});

describe('the rules that refuse', () => {
  it.each([
    ['file:///etc/passwd', 'scheme'],
    ['wss://site.example/socket', 'scheme'],
    ['http://169.254.169.254/latest/meta-data/', 'ip_literal'],
    ['http://[::ffff:7f00:1]/x.js', 'ip_literal'],
    ['http://[fd00::1]/', 'ip_literal'],
    ['https://user:pass@site.example/', 'credentials'],
    ['https://site.example:8080/', 'port'],
    ['http://localhost/', 'reserved_name'],
    ['http://intranet/', 'reserved_name'],
    ['http://printer.local/', 'reserved_name'],
    ['http://db.internal./', 'reserved_name'],
    ['https://site.example/files/report.zip?v=2', 'download'],
    ['https://www.googletagmanager.com/gtm.js?id=GTM-1', 'host_analytics'],
    ['https://cdn.cookielaw.org/consent.js', 'host_consent'],
    ['https://www.doubleclick.net./x.js', 'host_advertising'],
    ['https://site.example/files/REPORT.ZIP', 'download'],
    ['https://site.example/files/report.Zip?v=1', 'download'],
  ])('refuses %s by %s', (href, rule) => {
    expect(refusingRule(new URL(href).href)?.name).toBe(rule);
  });

  it.each([
    'https://site.example/',
    'http://site.example:80/page',
    'https://site.example:443/page',
    'https://123.site.example/page',
    'https://site.example/?file=report.zip',
    'https://site.example/report.zip.html',
    'https://0xcafe.de/',
    'https://0xbad.cafe/page',
    'data:text/html,hello',
    'blob:https://site.example/1234',
  ])('lets %s through', (href) => {
    expect(refusingRule(new URL(href).href)).toBeNull();
  });
});

describe('the reject-list', () => {
  const listed = REJECTED_HOSTS.flatMap((l) => l.hosts.map((h) => [l.name, h] as const));

  it.each(listed)('refuses %s host %s and its subdomains', (list, host) => {
    expect(refusingRule(`https://${host}/x.js`)?.name).toBe(`host_${list}`);
    expect(refusingRule(`https://cdn.${host}/x.js`)?.name).toBe(`host_${list}`);
  });

  // The matcher keys on the host's suffix, so vary the suffix boundary: a name that merely ends in
  // the same letters is a different host and must load.
  it.each(listed)('does not refuse a lookalike of %s host %s', (_list, host) => {
    expect(refusingRule(`https://not${host}/x.js`)).toBeNull();
    expect(refusingRule(`https://site.example/${host}/x.js`)).toBeNull();
    expect(refusingRule(`https://site.example/?ref=${host}`)).toBeNull();
  });

  // The failure a reject-list exists to avoid: a site's own JavaScript on a CDN under another name.
  it.each([
    'https://cdn.shopify.com/s/files/1/theme.js',
    'https://d111111abcdef8.cloudfront.net/app.js',
    'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
    'https://unpkg.com/vue@3.4.0/dist/vue.global.prod.js',
    'https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js',
    'https://static.wixstatic.com/app.js',
    'https://static.zdassets.com/hc/assets/theme.js',
    'https://www.bing.com/search',
    'https://www.facebook.com/page',
  ])('loads the script host %s', (href) => {
    expect(refusingRule(href)).toBeNull();
  });
});

describe('ordinary public pages', () => {
  // Labels that start with 0x are ordinary names when the last label is not numeric: a host matcher
  // keyed on digits must not take them for addresses.
  const label = fc.oneof(
    fc.stringMatching(/^[a-z][a-z0-9-]{0,14}[a-z0-9]$/),
    fc.stringMatching(/^0x[0-9a-f]{1,8}$/),
  );
  const tld = fc.constantFrom('com', 'org', 'net', 'io', 'co.uk', 'de', 'shop', 'zip');
  const path = fc.array(fc.stringMatching(/^[a-z0-9_-]{1,12}$/), { maxLength: 4 });

  it('are refused by no rule, so the render never blocks a page it was asked for', () => {
    const lists = new Set(REJECTED_HOSTS.flatMap((l) => l.hosts));
    fc.assert(
      fc.property(fc.array(label, { minLength: 1, maxLength: 3 }), tld, path, (labels, t, p) => {
        const host = `${labels.join('.')}.${t}`;
        fc.pre(![...lists].some((h) => host === h || host.endsWith(`.${h}`)));
        const href = new URL(`https://${host}/${p.join('/')}`).href;
        expect(refusingRule(href)).toBeNull();
      }),
      { numRuns: 500 },
    );
  });
});

describe('the rule list', () => {
  it('has a unique name for every rule', () => {
    const names = URL_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
