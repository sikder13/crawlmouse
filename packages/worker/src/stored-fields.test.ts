import { AccessTestSchema, LinkEdgeSchema } from '@crawlmouse/types/v2';
import { describe, expect, it, vi } from 'vitest';
import type { BatchRequest } from './batch/request.js';
import { runBatch, type BatchResult } from './batch/run.js';
import { RobotsCache } from './batch/site-rules.js';
import { CRAWLERS } from './identities.js';
import { Sites } from './politeness/sites.js';
import { CAPS } from './rows/bounded.js';
import { CrawlPageSchema } from './rows/crawl-page.js';
import { InstantClock } from './test-support/clock.js';
import { fakeFetcher, type FakeResponse } from './test-support/fake-fetcher.js';

/**
 * Every string the worker stores comes from rows/bounded.ts, or is a fixed format.
 *
 * The batches below overflow every field a site can fill: header values, a Location, a canonical,
 * anchor text, a body, robots.txt rules and the URLs that name origins. Every string in their results
 * is then classified by FIELDS: a `bounded` field's value must be one the helper returned (recorded by
 * wrapping it) and fit its cap; a fixed-format field must match its format. A string at a path FIELDS
 * does not list fails the test, and so does a string field of a stored row's schema that FIELDS does
 * not list, so a new field is classified before it ships.
 */

/** What the helper returned, by the name of the cap it was called with. */
const produced = vi.hoisted(() => new Map<string, Set<string>>());
vi.mock('./rows/bounded.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./rows/bounded.js')>();
  const recording = (value: string, cap: Parameters<typeof real.bounded>[1]) => {
    const out = (real.bounded as (v: string, c: typeof cap) => string | null)(value, cap);
    const name = Object.entries(real.CAPS).find(([, c]) => c === cap)?.[0] ?? 'not one of CAPS';
    if (out !== null) {
      if (!produced.has(name)) produced.set(name, new Set());
      produced.get(name)!.add(out);
    }
    return out;
  };
  return { ...real, bounded: recording };
});

type Cap = keyof typeof CAPS;
type Format = 'id' | 'batch_id' | 'timestamp' | 'enum';
/** A field is either made by the helper with the cap named, or a fixed format. */
type Field = Cap | Format;
const FORMATS: Record<Format, RegExp> = {
  id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  batch_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+$/,
  timestamp: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
  enum: /^[a-z0-9_]{1,64}$/,
};

const row = (prefix: string, fields: Record<string, Field>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [`${prefix}.${k}`, v]));
const HEADERS = { name: 'headerName', value: 'headerValue' } as const;
const EVIDENCE = {
  check_id: 'id',
  identity_sent: 'identity',
  source_ip_class: 'enum',
  'limitations[]': 'limitation',
  ...row('request_headers[]', HEADERS),
  final_url: 'url',
  ...row('headers[]', HEADERS),
  evidence_class: 'enum',
} as const;

/** Every string path a batch result can hold, and what it must be. */
const FIELDS: Record<string, Field> = {
  batch_id: 'batch_id',
  check_id: 'id',
  site_id: 'id',
  started_at: 'timestamp',
  finished_at: 'timestamp',
  kind: 'enum',
  'partial.reasons[]': 'enum',
  ...row('findings[]', {
    kind: 'enum',
    site: 'site',
    reason: 'enum',
    at: 'timestamp',
    until: 'timestamp',
    budget: 'enum',
    origin: 'origin',
    why: 'enum',
  }),
  ...row('robots[]', {
    origin: 'origin',
    state: 'enum',
    why: 'enum',
    final_url: 'url',
    fetched_at: 'timestamp',
    body_excerpt: 'bodyExcerpt',
  }),
  ...row('pages[]', {
    ...EVIDENCE,
    url: 'url',
    outcome: 'enum',
    response: 'enum',
    fetched_at: 'timestamp',
    raw_text: 'rawText',
    canonical_url: 'url',
  }),
  ...row('link_edges[]', {
    check_id: 'id',
    from_url: 'url',
    to_url: 'url',
    anchor_text: 'anchorText',
  }),
  'discovered_urls[]': 'url',
  ...row('access_tests[]', {
    ...EVIDENCE,
    id: 'id',
    ua: 'token',
    page_url: 'url',
    template_key: 'templateKey',
    tested_at: 'timestamp',
    verdict: 'enum',
    cause: 'enum',
    body_excerpt: 'bodyExcerpt',
  }),
};

/** Every string in `value`, with its path (array positions written `[]`). */
function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v) => strings(v, `${path}[]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/** The string fields a zod schema declares, by path. */
function schemaStrings(schema: unknown, path = ''): string[] {
  const def = (schema as { _zod: { def: Record<string, unknown> } })._zod.def;
  switch (def.type) {
    case 'string':
    case 'enum':
      return [path];
    case 'object':
      return Object.entries(def.shape as Record<string, unknown>).flatMap(([k, v]) =>
        schemaStrings(v, path ? `${path}.${k}` : k),
      );
    case 'array':
      return schemaStrings(def.element, `${path}[]`);
    case 'nullable':
    case 'optional':
      return schemaStrings(def.innerType, path);
    default:
      return [];
  }
}

// --- Batches that overflow every field a site can fill. -------------------------------------------

const LONG = 'x'.repeat(5000);
/**
 * A host past the site cap, so the site key a finding names is cut: matched by value, a key short
 * enough to equal the Host header the helper made would pass unbounded.
 */
const BUSY = `${'b'.repeat(300)}.example`;
const LONG_URL_PATH = `/${'p'.repeat(5000)}`;
const bigHeaders = (type: string) => ({
  'content-type': `${type}; ${LONG}`,
  server: LONG,
  'cf-ray': LONG,
  'retry-after': LONG,
  'crawler-price': LONG,
  'x-vercel-mitigated': LONG,
});
const html = (body: string): FakeResponse => ({
  status: 200,
  headers: bigHeaders('text/html'),
  body,
});
const PAGE = html(
  `<html><head><link rel="canonical" href="/c?${'é'.repeat(2000)}"></head><body>` +
    `<a href="/to">${'anchor '.repeat(2000)}</a><a href="${LONG_URL_PATH}">long</a>` +
    `<p>${'word '.repeat(100_000)}</p></body></html>`,
);

function respond(url: string, identity: { token: string | null }): FakeResponse {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') {
    if (u.hostname === 'unreachable.example')
      return { status: 503, headers: bigHeaders('text/plain'), body: LONG };
    return {
      status: 200,
      headers: bigHeaders('text/plain'),
      body: `User-agent: *\nDisallow: /${'r'.repeat(3000)}\n# ${LONG}\n`,
    };
  }
  if (u.hostname === BUSY) return { status: 429, headers: bigHeaders('text/html'), body: LONG };
  switch (u.pathname) {
    case '/long-location':
      return {
        status: 301,
        headers: { ...bigHeaders('text/html'), location: `https://example.com${LONG_URL_PATH}` },
        body: LONG,
      };
    case '/off-site':
      return {
        status: 302,
        headers: { ...bigHeaders('text/html'), location: `https://other.test${LONG_URL_PATH}` },
        body: '',
      };
    case '/normal':
      return html(
        `<html><head><link rel="canonical" href="/c"></head><body><p>${LONG}</p></body></html>`,
      );
    case '/odd-status':
      return { status: 999, headers: bigHeaders('text/html'), body: LONG };
    case '/refused':
      return identity.token === 'GPTBot'
        ? { status: 403, headers: bigHeaders('text/html'), body: `error code: 1020 ${LONG}` }
        : PAGE;
    default:
      return PAGE;
  }
}

const roomy = { max_requests: 1000, max_bytes: 50_000_000, max_seconds: 1800 };
const common = (batch: number) => ({
  check_id: '00000000-0000-4000-8000-0000000000c3',
  site_id: '00000000-0000-4000-8000-0000000000a3',
  batch,
  nonce: 'n'.repeat(16),
  jwt: 'x',
  budget: roomy,
});
const REQUESTS: BatchRequest[] = [
  {
    ...common(1),
    kind: 'crawl',
    urls: ['/', '/normal', '/long-location', '/off-site', '/odd-status'].map(
      (p) => `https://example.com${p}`,
    ),
  },
  {
    ...common(2),
    kind: 'access',
    pages: ['/', '/refused', '/off-site'].map((p) => ({
      url: `https://example.com${p}`,
      template_key: `/${'t'.repeat(500)}`,
    })),
  },
  { ...common(3), kind: 'crawl', urls: ['https://unreachable.example/a'] },
  // Three 429s stop the site: a finding that names it.
  {
    ...common(5),
    kind: 'crawl',
    urls: ['/a', '/b', '/c', '/d'].map((p) => `https://${BUSY}${p}`),
  },
  {
    ...common(4),
    kind: 'crawl',
    urls: ['https://example.com/'],
    budget: { ...roomy, max_requests: 1 },
  },
];

async function results(): Promise<BatchResult[]> {
  const clock = new InstantClock();
  const deps = {
    clock,
    sites: new Sites(clock),
    fetcher: fakeFetcher(clock, respond),
    robotsCache: new RobotsCache(clock),
  };
  const out: BatchResult[] = [];
  for (const req of REQUESTS) out.push(await runBatch(req, deps));
  return out;
}

describe('stored fields', () => {
  it('lists every string field of the stored rows', () => {
    const declared = [
      ...schemaStrings(CrawlPageSchema).map((p) => `pages[].${p}`),
      ...schemaStrings(LinkEdgeSchema).map((p) => `link_edges[].${p}`),
      ...schemaStrings(AccessTestSchema).map((p) => `access_tests[].${p}`),
    ];
    // 15 in CrawlPage, 4 in LinkEdge, 19 in AccessTest: the walk reaches the nested header fields.
    expect(declared).toHaveLength(38);
    expect(declared.filter((p) => !(p in FIELDS))).toEqual([]);
  });

  it('stores only strings the bounding helper made, within their caps, or fixed formats', async () => {
    produced.clear();
    const all = (await results()).flatMap((r) => strings(r));
    // The batches reached every kind of field.
    const seen = new Set(all.map(([p]) => p));
    for (const p of [
      'pages[].canonical_url',
      'link_edges[].anchor_text',
      'robots[].body_excerpt',
      'findings[].origin',
      'access_tests[].body_excerpt',
      'pages[].headers[].value',
      'access_tests[].template_key',
      'findings[].site',
    ]) {
      expect(seen, p).toContain(p);
    }
    const unlisted = [...seen].filter((p) => !(p in FIELDS));
    expect(unlisted).toEqual([]);
    const wrong = all.flatMap(([path, value]) => {
      const field = FIELDS[path]!;
      if (field in FORMATS) {
        return FORMATS[field as Format].test(value)
          ? []
          : [`${path}: not a ${field}: ${value.slice(0, 60)}`];
      }
      return produced.get(field)?.has(value)
        ? []
        : [`${path}: not made with CAPS.${field} (${value.length} chars)`];
    });
    expect(wrong).toEqual([]);
  }, 60_000);

  it('holds no stored string longer than its contract allows, at the sizes the batches above reach', async () => {
    const all = (await results()).flatMap((r) => strings(r));
    const longest = Math.max(...all.map(([, v]) => v.length));
    // The largest cap is the served text's 64 KiB; nothing a site sent at 5,000 characters or more
    // per field reaches a row whole unless it is that text.
    expect(longest).toBeLessThanOrEqual(64 * 1024);
    const overLong = all
      .filter(([p, v]) => p !== 'pages[].raw_text' && v.length > 2048)
      .map(([p, v]) => `${p}: ${v.length}`);
    expect(overLong).toEqual([]);
    expect(CRAWLERS.length).toBeGreaterThan(0);
  }, 60_000);
});
