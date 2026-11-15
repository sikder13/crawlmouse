import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIRST_TOUCH_BOUNDS,
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_MAX_AGE_S,
  firstTouchCookie,
  firstTouchFromCookies,
  readFirstTouch,
  rememberFirstTouch,
  type FirstTouch,
} from './first-touch';

const NOW = new Date('2026-11-15T15:04:05.678Z');
const OWN = 'crawlmouse.com';

const at = (href: string, referrer = '') => readFirstTouch({ href, referrer, ownHost: OWN }, NOW);

describe('readFirstTouch', () => {
  it('reads the utm tags, the referrer host, the landing path, ref and the time to the second', () => {
    expect(
      at(
        'https://crawlmouse.com/blog/robots-txt?utm_source=linkedin&utm_medium=social&utm_campaign=launch+week&utm_content=post-1&utm_term=ai%20crawlers&ref=abc_1#top',
        'https://www.LinkedIn.com/feed/?q=secret',
      ),
    ).toEqual({
      utm_source: 'linkedin',
      utm_medium: 'social',
      utm_campaign: 'launch week',
      utm_content: 'post-1',
      utm_term: 'ai crawlers',
      referrer_host: 'www.linkedin.com',
      landing_path: '/blog/robots-txt',
      ref: 'abc_1',
      first_seen_at: '2026-11-15T15:04:05Z',
    });
  });

  it('a bare landing holds the path and the time only', () => {
    expect(at('https://crawlmouse.com/')).toEqual({
      landing_path: '/',
      first_seen_at: '2026-11-15T15:04:05Z',
    });
  });

  it.each([
    ['our own host', 'https://crawlmouse.com/pricing'],
    ['our own host with www', 'https://www.crawlmouse.com/'],
    ['a non-web scheme', 'android-app://com.slack/'],
    ['an IPv6 literal', 'http://[::1]/'],
    ['a host with an underscore', 'https://a_b.example.com/'],
    ['a label of 64 characters', `https://${'a'.repeat(64)}.com/`],
    ['not a URL', 'nonsense'],
  ])('drops the referrer when it is %s', (_n, referrer) => {
    expect(at('https://crawlmouse.com/', referrer)).not.toHaveProperty('referrer_host');
  });

  it('drops a referrer host longer than 253 characters, and keeps one of 253', () => {
    const label = 'a'.repeat(63);
    const host253 = [label, label, label, 'a'.repeat(61)].join('.');
    expect(host253).toHaveLength(253);
    expect(at('https://crawlmouse.com/', `https://${host253}/`).referrer_host).toBe(host253);
    expect(at('https://crawlmouse.com/', `https://${host253}a/`)).not.toHaveProperty(
      'referrer_host',
    );
  });

  it.each([
    ['markup', '%3Cscript%3E'],
    ['a quote', '%22x'],
    ['a percent sign after decoding', '50%25'],
    ['a NUL', 'a%00b'],
    ['a newline', 'a%0Ab'],
    ['unicode', '%C3%A4'],
    ['an empty value', ''],
    ['101 characters', 'a'.repeat(101)],
    ['a colon', 'javascript:alert(1)'],
  ])('drops a utm value with %s', (_n, value) => {
    expect(at(`https://crawlmouse.com/?utm_source=${value}`)).not.toHaveProperty('utm_source');
  });

  it('keeps a utm value of 100 characters of its class', () => {
    const long = 'Az09 ._~+-'.repeat(10);
    expect(long).toHaveLength(100);
    const encoded = encodeURIComponent(long);
    expect(at(`https://crawlmouse.com/?utm_term=${encoded}`).utm_term).toBe(long);
  });

  it.each([
    ['a percent-encoded character', 'https://crawlmouse.com/caf%C3%A9'],
    ['201 characters', `https://crawlmouse.com/${'a'.repeat(200)}`],
    ['a colon', 'https://crawlmouse.com/a:b'],
  ])('drops a landing path with %s', (_n, href) => {
    expect(at(href)).not.toHaveProperty('landing_path');
  });

  it('keeps a landing path of 200 characters, and never its query or fragment', () => {
    const path = `/${'a'.repeat(199)}`;
    expect(at(`https://crawlmouse.com${path}?x=1#y`).landing_path).toBe(path);
  });

  it.each([
    ['65 characters', 'a'.repeat(65)],
    ['a dot', 'a.b'],
    ['a space', 'a%20b'],
    ['an empty value', ''],
  ])('drops a ref with %s', (_n, ref) => {
    expect(at(`https://crawlmouse.com/?ref=${ref}`)).not.toHaveProperty('ref');
  });

  it('keeps a ref of 64 characters of its class', () => {
    const ref = `${'aZ09_-'.repeat(10)}abcd`;
    expect(ref).toHaveLength(64);
    expect(at(`https://crawlmouse.com/?ref=${ref}`).ref).toBe(ref);
  });

  it('reads nothing from a page address that is not a URL, but keeps the time', () => {
    expect(readFirstTouch({ href: 'nonsense', referrer: '', ownHost: OWN }, NOW)).toEqual({
      first_seen_at: '2026-11-15T15:04:05Z',
    });
  });
});

describe('the cm_ft cookie', () => {
  const record: FirstTouch = {
    utm_source: 'product hunt',
    referrer_host: 'news.ycombinator.com',
    landing_path: '/',
    first_seen_at: '2026-11-15T15:04:05Z',
  };

  it('is cm_ft, kept 90 days, on the whole site, SameSite=Lax', () => {
    const cookie = firstTouchCookie(record);
    expect(FIRST_TOUCH_COOKIE).toBe('cm_ft');
    expect(FIRST_TOUCH_MAX_AGE_S).toBe(90 * 24 * 60 * 60);
    expect(cookie).toMatch(/^cm_ft=[^;]+; Max-Age=7776000; Path=\/; SameSite=Lax$/);
  });

  it('reads back what it wrote, from document.cookie or a Cookie header', () => {
    const pair = firstTouchCookie(record).split(';')[0]!;
    expect(firstTouchFromCookies(`a=1; ${pair}; b=2`)).toEqual(record);
  });

  it('reads back a value a server framework has already URL-decoded', () => {
    const pair = firstTouchCookie(record).split(';')[0]!;
    expect(firstTouchFromCookies(decodeURIComponent(pair))).toEqual(record);
  });

  it.each([
    ['no cookie', 'a=1'],
    ['not JSON', 'cm_ft=%7Bnope'],
    ['bad encoding', 'cm_ft=%E0%A4%A'],
    ['an array', `cm_ft=${encodeURIComponent('[]')}`],
    ['no time', `cm_ft=${encodeURIComponent(JSON.stringify({ utm_source: 'x' }))}`],
    [
      'a time with milliseconds',
      `cm_ft=${encodeURIComponent(JSON.stringify({ first_seen_at: '2026-11-15T15:04:05.678Z' }))}`,
    ],
    [
      'a time that is no date',
      `cm_ft=${encodeURIComponent(JSON.stringify({ first_seen_at: '2026-13-45T15:04:05Z' }))}`,
    ],
  ])('reads nothing from %s', (_n, cookies) => {
    expect(firstTouchFromCookies(cookies)).toBeNull();
  });

  it('re-checks every field it reads back, and keeps no field it does not know', () => {
    const forged = {
      utm_source: '<script>',
      referrer_host: 'https://evil.example/path?q=1',
      landing_path: '/a?b=c',
      ref: 'x'.repeat(65),
      utm_medium: 42,
      email: 'someone@example.com',
      first_seen_at: '2026-11-15T15:04:05Z',
    };
    const json = JSON.stringify(forged).replace('{', '{"__proto__":{"utm_term":"polluted"},');
    const read = firstTouchFromCookies(`cm_ft=${encodeURIComponent(json)}`);
    expect(read).toEqual({ first_seen_at: '2026-11-15T15:04:05Z' });
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
  });
});

describe('rememberFirstTouch', () => {
  function jar(initial = '') {
    const writes: string[] = [];
    let cookie = initial;
    return {
      writes,
      doc: {
        get cookie() {
          return cookie;
        },
        set cookie(v: string) {
          writes.push(v);
          cookie = cookie ? `${cookie}; ${v.split(';')[0]}` : v.split(';')[0]!;
        },
      },
    };
  }
  const page = { href: 'https://crawlmouse.com/?utm_source=x', referrer: '', ownHost: OWN };

  it('writes the cookie once, on the first landing', () => {
    const j = jar();
    rememberFirstTouch({ document: j.doc, optedOut: () => false, page, now: () => NOW });
    rememberFirstTouch({
      document: j.doc,
      optedOut: () => false,
      page: { ...page, href: 'https://crawlmouse.com/?utm_source=y' },
      now: () => new Date('2026-12-01T00:00:00Z'),
    });
    expect(j.writes).toHaveLength(1);
    expect(firstTouchFromCookies(j.doc.cookie)?.utm_source).toBe('x');
  });

  it('never overwrites a cookie that is there, even one it cannot read', () => {
    const j = jar('cm_ft=garbage');
    rememberFirstTouch({ document: j.doc, optedOut: () => false, page, now: () => NOW });
    expect(j.writes).toEqual([]);
  });

  it('writes nothing while capture is opted out', () => {
    const j = jar();
    rememberFirstTouch({ document: j.doc, optedOut: () => true, page, now: () => NOW });
    expect(j.writes).toEqual([]);
  });

  it('does not mistake another cookie whose name ends in cm_ft for it', () => {
    const j = jar('xcm_ft=1');
    rememberFirstTouch({ document: j.doc, optedOut: () => false, page, now: () => NOW });
    expect(j.writes).toHaveLength(1);
  });
});

// ─── Hostile input, against the bounds here and the migration's CHECKs ─────────────────────────

const MIGRATION = readFileSync(
  join(__dirname, '../../../../infra/supabase/migrations/20261120000001_v2_041_analytics.sql'),
  'utf8',
);

/** The regex each account_attribution column's CHECK applies, as the migration writes it. */
function migrationRegex(column: string): string {
  const m = new RegExp(`^\\s+${column} text check \\(\\s*${column} ~ '([^']+)'`, 'm').exec(
    MIGRATION,
  );
  if (!m) throw new Error(`no CHECK regex for ${column} in the migration`);
  return m[1]!;
}

const COLUMNS = {
  utm_source: 'utm',
  utm_medium: 'utm',
  utm_campaign: 'utm',
  utm_content: 'utm',
  utm_term: 'utm',
  referrer_host: 'referrer_host',
  landing_path: 'landing_path',
  ref: 'ref',
} as const;

describe('the bounds are the migration CHECKs', () => {
  it.each(Object.entries(COLUMNS))('%s', (column, bound) => {
    expect(FIRST_TOUCH_BOUNDS[bound]).toBe(migrationRegex(column));
  });

  it('and the host length bound is 253, as there', () => {
    expect(MIGRATION).toContain('and length(referrer_host) <= 253)');
  });
});

const hostile = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 300 }),
  fc.string({ unit: 'grapheme', maxLength: 40 }),
  fc.constantFrom(
    '<script>alert(1)</script>',
    '%00',
    '%E0%A4%A',
    'javascript:alert(1)',
    '../../etc/passwd',
    'a'.repeat(10_000),
    '%2e%2e%2f',
    '‮',
    'ẞ',
    '"\'\\',
  ),
);

const hostileUrl = fc.oneof(
  fc.webUrl({ withQueryParameters: true, withFragments: true }),
  fc.tuple(fc.webUrl(), hostile).map(([u, h]) => `${u}${h}`),
  hostile,
);

describe('a property: whatever the landing, every field it records passes the database', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await PGlite.create();
  });
  afterAll(async () => {
    await pg.close();
  });

  it('holds over hostile page addresses, referrers and parameter values', async () => {
    await fc.assert(
      fc.asyncProperty(
        hostileUrl,
        hostileUrl,
        fc.record({
          utm_source: hostile,
          utm_medium: hostile,
          utm_campaign: hostile,
          utm_content: hostile,
          utm_term: hostile,
          ref: hostile,
        }),
        async (base, referrer, params) => {
          let href = base;
          try {
            const u = new URL(base);
            for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
            href = u.toString();
          } catch {
            /* a page address that is not a URL */
          }
          const record = readFirstTouch({ href, referrer, ownHost: OWN }, NOW);
          for (const [column, value] of Object.entries(record)) {
            if (column === 'first_seen_at') {
              expect(value).toBe('2026-11-15T15:04:05Z');
              continue;
            }
            const regex = migrationRegex(column);
            const { rows } = await pg.query<{ ok: boolean }>(
              `select $1::text ~ $2::text and length($1::text) <= 253 as ok`,
              [value, regex],
            );
            expect({ column, value, ok: rows[0]!.ok }).toEqual({ column, value, ok: true });
          }
          const pair = firstTouchCookie(record).split(';')[0]!;
          expect(firstTouchFromCookies(pair)).toEqual(record);
        },
      ),
      { numRuns: 300 },
    );
  }, 60_000);
});
