import {
  AccessTestSchema,
  DECLARATION_PATHS,
  FrontendMarkerSchema,
  LinkEdgeSchema,
} from '@crawlmouse/types/v2';
import { describe, expect, it, vi } from 'vitest';
import type { BatchRequest } from './batch/request.js';
import { runBatch, type BatchResult } from './batch/run.js';
import { RobotsCache } from './batch/site-rules.js';
import * as identities from './identities.js';
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
type Format =
  | 'id'
  | 'batch_id'
  | 'timestamp'
  | 'enum'
  | 'method'
  | 'http_version'
  | 'simhash'
  | 'search_engine'
  | 'fly_region'
  | 'worker_release'
  | 'declaration_path'
  | 'tag'
  | 'stack_source'
  | 'frontend_marker';
/** A field is either made by the helper with the cap named, or a fixed format. */
type Field = Cap | Format;
const FORMATS: Record<Format, RegExp> = {
  id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  batch_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+$/,
  timestamp: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
  enum: /^[a-z0-9_]{1,64}$/,
  method: /^GET$/,
  http_version: /^1\.1$/,
  simhash: /^[0-9a-f]{16}$/,
  // vantage.ts: validated at start against the contract's own patterns.
  fly_region: /^[a-z]{3}$/,
  worker_release: /^(?:[0-9a-f]{12}|unreleased)$/,
  declaration_path: new RegExp(
    `^(?:${DECLARATION_PATHS.map((p) => p.replace(/\./g, '\\.')).join('|')})$`,
  ),
  // An element name, as the parser gives it (a content feature's block).
  tag: /^[a-z][a-z0-9]*$/,
  // A module constant (batch/crawl.ts STACK_SOURCE).
  stack_source: /^HTML and response headers$/,
  // A FrontendMarker value: the reader returns names from the enum, never page text.
  frontend_marker: new RegExp(`^(?:${FrontendMarkerSchema.options.join('|')})$`),
  // A registry token, a module constant (identities.ts SEARCH_ENGINES).
  search_engine: new RegExp(`^(?:${identities.SEARCH_ENGINES.map((e) => e.token).join('|')})$`),
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
  fly_region: 'fly_region',
  request_signing: 'enum',
  signature_verified: 'enum',
  worker_release: 'worker_release',
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
    identity_sent: 'identity',
    state: 'enum',
    why: 'enum',
    final_url: 'url',
    fetched_at: 'timestamp',
    body_excerpt: 'bodyExcerpt',
    body: 'robotsFile',
  }),
  ...row('pages[]', {
    ...EVIDENCE,
    url: 'url',
    outcome: 'enum',
    response: 'enum',
    fetched_at: 'timestamp',
    raw_text: 'rawText',
    canonical_url: 'url',
    'redirect.hops[].from': 'url',
    'redirect.hops[].location': 'url',
    'canonical_declared.href': 'declaredHref',
    'canonical_declared.url': 'url',
    'hreflang.links[].hreflang': 'hreflang',
    'hreflang.links[].href': 'url',
    content_simhash: 'simhash',
    'robots_search[].ua': 'search_engine',
    'robots_search[].verdict': 'enum',
    'title.text': 'title',
    'meta_description.text': 'description',
    'content_features.opening[].tag': 'tag',
    'content_features.json_ld[].types[]': 'jsonLdType',
    'stack_signals.cms': 'enum',
    'stack_signals.detected_from': 'stack_source',
    'stack_signals.frontend_markers[]': 'frontend_marker',
  }),
  ...row('declarations[]', {
    origin: 'origin',
    path: 'declaration_path',
    state: 'enum',
    media_type: 'mediaType',
    not_requested: 'enum',
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
    identity_role: 'enum',
    'witness.role': 'enum',
    'witness.ua': 'token',
    method: 'method',
    http_version: 'http_version',
  }),
};

/**
 * Every string in `value`, with its path: array positions written `[]`, and the keys of the objects
 * at the paths in `anyKey` (robots.txt agents, header names) written `<key>`.
 */
function strings(
  value: unknown,
  path = '',
  anyKey: readonly string[] = [],
): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v) => strings(v, `${path}[]`, anyKey));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => {
      const key = anyKey.includes(path) ? '<key>' : k;
      return strings(v, path ? `${path}.${key}` : key, anyKey);
    });
  }
  return [];
}

/** The identities are module constants, shared by every request and reading. */
const IDENTITY_STRINGS = new Set(strings(Object.values(identities)).map(([, v]) => v));

/** Every string path a robots.txt reading in the cache can hold, and what it must be. */
const CACHED: Record<string, Field | 'empty'> = {
  state: 'enum',
  why: 'enum',
  'rules.rules.<key>.allow[]': 'robotsRule',
  'rules.rules.<key>.disallow[]': 'robotsRule',
  'fetch.url': 'robotsUrl',
  'fetch.finalUrl': 'robotsUrl',
  'fetch.headers.<key>': 'headerValue',
  'fetch.hops[].from': 'robotsUrl',
  'fetch.hops[].location': 'empty',
  'fetch.redirectStop': 'enum',
  'fetch.error': 'enum',
  'fetch.body': 'robotsExcerpt',
  file: 'robotsFile',
};

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
  `<html><head><link rel="canonical" href="/c?${'é'.repeat(2000)}">` +
    `<link rel="alternate" hreflang="en-GB" href="/en?${'é'.repeat(2000)}">` +
    `<link rel="alternate" hreflang="${'h'.repeat(5000)}" href="/h">` +
    `<link rel="alternate" hreflang="fr" href="${LONG_URL_PATH}">` +
    `<link rel="alternate" hreflang="de" href="/de">` +
    `<script type="application/ld+json">{"@type":"Product","description":"d"}</script></head><body>` +
    `<h1>A product</h1><script src="/_next/static/a.js"></script>` +
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
  return (await stored()).results;
}

/** The batches' results, and the robots.txt cache they leave. */
async function stored(): Promise<{ results: BatchResult[]; cache: RobotsCache }> {
  const clock = new InstantClock();
  const deps = {
    clock,
    sites: new Sites(clock),
    fetcher: fakeFetcher(clock, respond),
    robotsCache: new RobotsCache(clock),
  };
  const out: BatchResult[] = [];
  for (const req of REQUESTS) out.push(await runBatch(req, deps));
  return { results: out, cache: deps.robotsCache };
}

describe('stored fields', () => {
  it('lists every string field of the stored rows', () => {
    const declared = [
      ...schemaStrings(CrawlPageSchema).map((p) => `pages[].${p}`),
      ...schemaStrings(LinkEdgeSchema).map((p) => `link_edges[].${p}`),
      ...schemaStrings(AccessTestSchema).map((p) => `access_tests[].${p}`),
    ];
    // 35 in CrawlPage, 4 in LinkEdge, 26 in AccessTest: the walk reaches the nested header, page
    // fact, content feature and stack fields. AccessTest's request line is two literals, a fixed
    // format the walk does not list.
    expect(declared).toHaveLength(65);
    expect(declared.filter((p) => !(p in FIELDS))).toEqual([]);
  });

  it('stores only strings the bounding helper made, within their caps, or fixed formats', async () => {
    produced.clear();
    const all = (await results()).flatMap((r) => strings(r));
    // The batches reached every kind of field.
    const seen = new Set(all.map(([p]) => p));
    for (const p of [
      'pages[].canonical_url',
      'pages[].canonical_declared.href',
      'pages[].hreflang.links[].hreflang',
      'pages[].hreflang.links[].href',
      'pages[].redirect.hops[].from',
      'pages[].content_simhash',
      'pages[].robots_search[].ua',
      'link_edges[].anchor_text',
      'robots[].body_excerpt',
      'robots[].body',
      'pages[].content_features.opening[].tag',
      'pages[].content_features.json_ld[].types[]',
      'pages[].stack_signals.detected_from',
      'pages[].stack_signals.frontend_markers[]',
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

  it('caches only robots.txt strings the bounding helper made, or fixed formats', async () => {
    produced.clear();
    const { cache } = await stored();
    const readings = cache.readings();
    expect(readings.length).toBeGreaterThan(0);
    const all = readings.flatMap((r) => strings(r, '', ['rules.rules', 'fetch.headers']));
    const seen = new Set(all.map(([p]) => p));
    for (const p of [
      'rules.rules.<key>.disallow[]',
      'fetch.headers.<key>',
      'fetch.body',
      'fetch.url',
      'file',
    ]) {
      expect(seen, p).toContain(p);
    }
    const isIdentity = (p: string) => p.startsWith('fetch.identity.');
    expect([...seen].filter((p) => !(p in CACHED) && !isIdentity(p))).toEqual([]);
    const wrong = all.flatMap(([path, value]) => {
      if (isIdentity(path)) return IDENTITY_STRINGS.has(value) ? [] : [`${path}: not an identity`];
      const field = CACHED[path]!;
      if (field === 'empty') return value === '' ? [] : [`${path}: not empty`];
      if (field in FORMATS)
        return FORMATS[field as Format].test(value) ? [] : [`${path}: not a ${field}`];
      return produced.get(field)?.has(value)
        ? []
        : [`${path}: not made with CAPS.${field} (${value.length} chars)`];
    });
    expect(wrong).toEqual([]);
  }, 60_000);

  it('holds no stored string longer than its contract allows, at the sizes the batches above reach', async () => {
    const all = (await results()).flatMap((r) => strings(r));
    // robots.txt kept whole for the check builder has its own cap, the engine's parse limit.
    const files = all.filter(([p]) => p === 'robots[].body');
    expect(files.length).toBeGreaterThan(0);
    expect(Math.max(...files.map(([, v]) => v.length))).toBeLessThanOrEqual(CAPS.robotsFile.chars);
    const rest = all.filter(([p]) => p !== 'robots[].body');
    const longest = Math.max(...rest.map(([, v]) => v.length));
    // Past that, the largest cap is the served text's 64 KiB; nothing a site sent at 5,000 characters
    // or more per field reaches a row whole unless it is that text.
    expect(longest).toBeLessThanOrEqual(64 * 1024);
    const overLong = rest
      .filter(([p, v]) => p !== 'pages[].raw_text' && v.length > 2048)
      .map(([p, v]) => `${p}: ${v.length}`);
    expect(overLong).toEqual([]);
    expect(CRAWLERS.length).toBeGreaterThan(0);
  }, 60_000);
});
