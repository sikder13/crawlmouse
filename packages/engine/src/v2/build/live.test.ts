/**
 * The builder on the deployed staging worker (docs/ops/worker-runbook.md), crawling crawlmouse.com:
 * the crawl batches nextCrawlBatch plans to a 50-page cap, the stage-1 access batch `sample` plans,
 * then buildCheck. Skipped, not failed, unless all three are set (the owner keeps them in
 * scripts/.env.local):
 *   CRAWL_WORKER_URL        the worker's base URL
 *   WORKER_SIGNING_SECRET   the HMAC secret the worker and the app share
 *   WORKER_JWT_PRIVATE_KEY  the Ed25519 key the per-batch JWT is signed with: PKCS8 PEM, or the JWK
 *                           `d` beside WORKER_JWT_PUBLIC_KEY's `x`
 * The JWT is signed with the worker's own test helper; the real client is CC-20b's. Nothing here is a
 * key: every value is read from the environment.
 */
import { createPrivateKey, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { BatchResult, CrawlBatchResult } from '@crawlmouse/types/v2';
import {
  signBatch,
  signRead,
  SIGNATURE_HEADER,
  TS_HEADER,
} from '../../../../worker/src/auth/hmac.js';
import { claims, signJwt } from '../../../../worker/src/test-support/jwt.js';
import { templateKeyFor } from '../../analysis/template-key.js';
import { assemble, buildCheck, nextCrawlBatch, readBatches, sample } from './index.js';
import type { BuildInput, Seed } from './types.js';

const URL_ = process.env.CRAWL_WORKER_URL;
const SECRET = process.env.WORKER_SIGNING_SECRET;
const PRIVATE = process.env.WORKER_JWT_PRIVATE_KEY;
const configured = !!URL_ && !!SECRET && !!PRIVATE;

const HOME = 'https://crawlmouse.com';
const PAGE_CAP = 50;

function privateKey() {
  if (PRIVATE!.includes('BEGIN')) return createPrivateKey(PRIVATE!);
  const x = process.env.WORKER_JWT_PUBLIC_KEY;
  if (!x)
    throw new Error('WORKER_JWT_PRIVATE_KEY is a JWK d; WORKER_JWT_PUBLIC_KEY must give its x');
  return createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: PRIVATE!, x }, format: 'jwk' });
}

async function run(
  check: { id: string; site_id: string },
  batch: number,
  body: object,
): Promise<BatchResult> {
  const nonce = randomUUID().replace(/-/g, '');
  const jwt = signJwt(
    privateKey(),
    claims({
      check_id: check.id,
      site_id: check.site_id,
      site_host: 'crawlmouse.com',
      batch,
      nonce,
    }),
  );
  const request = JSON.stringify({
    check_id: check.id,
    site_id: check.site_id,
    batch,
    nonce,
    jwt,
    ...body,
  });
  const ts = String(Date.now());
  const posted = await fetch(`${URL_}/batch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TS_HEADER]: ts,
      [SIGNATURE_HEADER]: signBatch(SECRET!, ts, request),
    },
    body: request,
  });
  if (posted.status !== 202)
    throw new Error(`POST /batch answered ${posted.status}: ${await posted.text()}`);
  const { batch_id } = (await posted.json()) as { batch_id: string };
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const t = String(Date.now());
    const read = await fetch(`${URL_}/batch/${batch_id}`, {
      headers: { [TS_HEADER]: t, [SIGNATURE_HEADER]: signRead(SECRET!, t, `batch:${batch_id}`) },
    });
    const r = (await read.json()) as { status: string; result?: BatchResult };
    if (r.status === 'done') return r.result!;
    if (r.status === 'failed') throw new Error(`batch ${batch_id} failed`);
  }
  throw new Error(`batch ${batch_id} did not finish in 10 minutes`);
}

describe.skipIf(!configured)('the builder on the staging worker', () => {
  it(
    "builds a valid check of crawlmouse.com from the worker's batches",
    async () => {
      const check = { id: randomUUID(), site_id: randomUUID() };
      const budget = { max_requests: 2000, max_bytes: 100_000_000, max_seconds: 900 };
      const seeds: Seed[] = [{ url: HOME, source: 'homepage', lastmod: null }];
      const batches: BatchResult[] = [];
      for (;;) {
        const crawl = batches.filter((b): b is CrawlBatchResult => b.kind === 'crawl');
        const urls = nextCrawlBatch(seeds, crawl, PAGE_CAP);
        if (urls === null) break;
        batches.push(await run(check, batches.length, { kind: 'crawl', budget, urls }));
      }
      const release = (batches[0] as CrawlBatchResult).pages[0]!.worker_release;
      const now = new Date().toISOString();
      const input: Omit<BuildInput, 'batches'> = {
        check: {
          ...check,
          previous_check_id: null,
          trigger: 'manual',
          queued_at: now,
          started_at: now,
          finished_at: now,
          expires_at: null,
          page_cap: PAGE_CAP,
          grade_version: '2.0.0',
        },
        site: {
          id: check.site_id,
          account_id: null,
          host: 'crawlmouse.com',
          staging_of_site_id: null,
          client_name: null,
          client_contact_name: null,
          client_contact_email: null,
          schedule: null,
          paused: false,
          competitor_hosts: [],
          slack_channel: null,
          owner_seat_id: null,
          client_report: null,
          created_at: now,
        },
        homepage_url: HOME,
        seeds,
        render: null,
        previous: null,
        fixes: [],
        events: [],
        lineage: { engine_sha: '0'.repeat(40), worker_release: release },
        now,
      };
      const stage1 = sample(assemble(input, readBatches(batches, check, release))).stage1;
      const pages = stage1.map((p) => ({ url: p.url, template_key: templateKeyFor(p.url) }));
      batches.push(await run(check, batches.length, { kind: 'access', budget, pages }));
      const built = buildCheck({ ...input, batches });
      // The summary goes in the PR text.
      console.log(
        JSON.stringify({
          release,
          summaries: built.summaries,
          fixes: built.fixes.map((f) => f.type),
        }),
      );
      expect(built.page_results.length).toBeGreaterThan(0);
      expect(built.check.status === 'finished' || built.check.status === 'partial').toBe(true);
    },
    20 * 60_000,
  );
});
