/**
 * Writes the access fixtures in this directory that come from running the crawl worker. Each one is
 * the worker's own `runBatch` output for an access batch, so the rows have exactly the shape and the
 * verdicts the deployed worker gives: the engine is tested on what it will be handed, not on rows
 * written to suit it. Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx fixtures/v2/access/generate.ts
 *
 * The worker is only read here. What each fixture is made from:
 *   - `<site>-shape.json`: the five discriminator sites, served by the worker's own test server from
 *     the response shapes recorded in the POC runs (`worker/src/test-support/discriminators.ts`). The
 *     host is renamed `<site>-shape.test`: the paths are the test server's, not the site's.
 *   - `npr-robots-unreachable.json`: DERIVED. The CC-12b staging smoke ran only a crawl batch on
 *     www.npr.org, whose robots.txt timed out from the Fly egress. This is the access batch the worker
 *     gives for the same two URLs when robots.txt times out; no live access batch was run on NPR.
 *   - `edge-default-*.json`: synthetic. A site whose robots.txt allows every crawler and serves the
 *     browser control, while the edge refuses some crawler user agents, in the two ways Cloudflare
 *     answers (a firewall rule's 403 with error 1020, and a challenge marked `cf-mitigated`).
 *
 * Row ids are renumbered, so a regeneration changes only what the worker changed.
 */
import { writeFileSync } from 'node:fs';
import type { AccessTest } from '@crawlmouse/types/v2';
import { createFetcher } from '../../../../worker/src/fetch/fetcher.js';
import type { Identity } from '../../../../worker/src/identities.js';
import { Sites } from '../../../../worker/src/politeness/sites.js';
import { InstantClock } from '../../../../worker/src/test-support/clock.js';
import {
  pagePath,
  SAMPLE_PAGES,
  SITES,
  siteServer,
} from '../../../../worker/src/test-support/discriminators.js';
import {
  fakeFetcher,
  type FakeResponse,
} from '../../../../worker/src/test-support/fake-fetcher.js';
import type { Fetcher } from '../../../../worker/src/fetch/fetcher.js';
import type { BatchRequest } from '../../../../worker/src/batch/request.js';
import { runBatch } from '../../../../worker/src/batch/run.js';
import { RobotsCache } from '../../../../worker/src/batch/site-rules.js';

const CHECK = 'c0000000-0000-4000-8000-0000000000c1';
const SITE_ID = 'a0000000-0000-4000-8000-0000000000a1';
const OUT = new URL('./', import.meta.url);

interface AccessFixture {
  provenance: string;
  access_tests: AccessTest[];
}

function request(pages: { url: string; template_key: string }[]): BatchRequest {
  return {
    kind: 'access',
    check_id: CHECK,
    site_id: SITE_ID,
    batch: 1,
    nonce: 'fixture-nonce-0001',
    jwt: 'not-read-by-run-batch',
    budget: { max_requests: 1000, max_bytes: 50_000_000, max_seconds: 1800 },
    pages,
  };
}

async function access(
  pages: { url: string; template_key: string }[],
  fetcher: (clock: InstantClock) => Fetcher,
): Promise<AccessTest[]> {
  const clock = new InstantClock();
  const result = await runBatch(request(pages), {
    clock,
    sites: new Sites(clock),
    fetcher: fetcher(clock),
    robotsCache: new RobotsCache(clock),
  });
  if (result.kind !== 'access') throw new Error('generate: expected an access result');
  return result.access_tests;
}

/** Row ids in row order, so the file does not change when nothing else did. */
const renumbered = (rows: AccessTest[]): AccessTest[] =>
  rows.map((r, i) => ({ ...r, id: `e0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));

function write(name: string, provenance: string, rows: AccessTest[]): void {
  const fixture: AccessFixture = { provenance, access_tests: renumbered(rows) };
  writeFileSync(new URL(name, OUT), `${JSON.stringify(fixture, null, 2)}\n`);
}

const sample = (base: string) =>
  Array.from({ length: SAMPLE_PAGES }, (_, i) => ({
    url: `${base}${pagePath(i)}`,
    template_key: i === 0 ? '/' : '/p/{n}',
  }));

async function discriminators(): Promise<void> {
  for (const site of SITES) {
    const server = await siteServer(site);
    try {
      const rows = await access(sample(server.base), (clock) =>
        createFetcher(clock, { bypassSsrf: true }),
      );
      const host = `${site.replace(/\./g, '-')}-shape.test`;
      const loopback = server.base.replace(/^http:\/\//, '');
      const renamed = JSON.parse(
        JSON.stringify(rows).replaceAll(server.base, `https://${host}`).replaceAll(loopback, host),
      ) as AccessTest[];
      write(
        `${site.replace(/\./g, '-')}-shape.json`,
        `The worker's access rows for ${SAMPLE_PAGES} pages served with the response shapes recorded for ${site} in the POC runs (worker/src/test-support/discriminators.ts). Host renamed; the paths are the test server's.`,
        renamed,
      );
    } finally {
      await server.close();
    }
  }
}

const html = (words: number) =>
  `<html><head><title>t</title></head><body><p>${Array.from({ length: words }, (_, i) => `w${i}`).join(' ')}</p></body></html>`;

/** A fetcher that answers robots.txt, the control and the canary as a normal site, and each crawler by `crawler`. */
const site =
  (robots: FakeResponse, crawler: (id: Identity) => FakeResponse, canary: FakeResponse) =>
  (clock: InstantClock) =>
    fakeFetcher(clock, (url, id) => {
      if (new URL(url).pathname === '/robots.txt') return robots;
      if (id.role === 'canary') return canary;
      if (id.role === 'crawler') return crawler(id);
      return { status: 200, headers: { 'content-type': 'text/html' }, body: html(200) };
    });

const SERVED: FakeResponse = {
  status: 200,
  headers: { 'content-type': 'text/html' },
  body: html(200),
};
const ROBOTS_ALLOW_ALL: FakeResponse = {
  status: 200,
  headers: { 'content-type': 'text/plain' },
  body: 'User-agent: *\nAllow: /\n',
};
const CF_1020: FakeResponse = {
  status: 403,
  headers: { 'content-type': 'text/plain', server: 'cloudflare', 'cf-ray': '8f00000000000000-IAD' },
  body: 'error code: 1020',
};
const CF_CHALLENGE: FakeResponse = {
  status: 403,
  headers: {
    'content-type': 'text/html',
    server: 'cloudflare',
    'cf-ray': '8f00000000000001-IAD',
    'cf-mitigated': 'challenge',
  },
  body: '<html><head><title>Just a moment...</title></head><body></body></html>',
};
const PLAIN_403: FakeResponse = {
  status: 403,
  headers: { 'content-type': 'text/html', server: 'cloudflare' },
  body: '<html><body>Forbidden</body></html>',
};

/** Training crawlers refused by a firewall rule, the user-initiated agent challenged, the search crawlers served. */
const byCategory = (id: Identity): FakeResponse =>
  id.token === 'GPTBot' || id.token === 'ClaudeBot'
    ? CF_1020
    : id.token === 'ChatGPT-User'
      ? CF_CHALLENGE
      : SERVED;

const EDGE_PAGES = [
  { url: 'https://edge-default.test/', template_key: '/' },
  { url: 'https://edge-default.test/guides/one', template_key: '/guides/{slug}' },
  { url: 'https://edge-default.test/guides/two', template_key: '/guides/{slug}' },
];

async function edgeDefault(): Promise<void> {
  write(
    'edge-default-ua-rule.json',
    "Synthetic. robots.txt allows every crawler and the browser control is served. The edge answers GPTBot and ClaudeBot with Cloudflare's firewall-rule 403 (error code: 1020), challenges ChatGPT-User (cf-mitigated: challenge), and serves the search crawlers. The tagged Googlebot canary is served, so the worker reads the refusals as user-agent rules.",
    await access(EDGE_PAGES, site(ROBOTS_ALLOW_ALL, byCategory, SERVED)),
  );
  write(
    'edge-default-unverified.json',
    'Synthetic. As edge-default-ua-rule.json, except that the edge also refuses the tagged Googlebot canary and answers the refused crawlers with a plain 403, so the worker cannot tell a user-agent rule from IP verification.',
    await access(
      EDGE_PAGES,
      site(ROBOTS_ALLOW_ALL, (id) => (byCategory(id) === SERVED ? SERVED : PLAIN_403), PLAIN_403),
    ),
  );
}

async function nprRobotsUnreachable(): Promise<void> {
  write(
    'npr-robots-unreachable.json',
    'DERIVED, not observed. The CC-12b staging smoke (2026-11-03) ran a crawl batch on these two www.npr.org URLs, and robots.txt timed out from the Fly egress, so nothing was requested. No access batch was run on NPR live. These are the rows the worker gives for an access batch on the same URLs when robots.txt times out.',
    await access(
      [
        { url: 'https://www.npr.org/sections/news/', template_key: '/sections/{slug}' },
        { url: 'https://www.npr.org/sections/news/?smoke=1', template_key: '/sections/{slug}' },
      ],
      (clock) => fakeFetcher(clock, () => ({ error: 'timeout' })),
    ),
  );
}

await discriminators();
await edgeDefault();
await nprRobotsUnreachable();
