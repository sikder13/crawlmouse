import { randomBytes, createHash } from 'node:crypto';
import { signBatch, signTs, signJwt } from './worker/auth.js';
import type { BatchRequest } from './worker/batch.js';
import { CRAWLER_TOKENS } from './worker/identities.js';
import { summarize, type Verdict } from './worker/classify.js';
import { matchesExpectation, type SiteName } from './fixtures/shapes.js';
import { SSRF_CASES } from './fixtures/ssrf.js';

export type Row = Record<string, unknown>;

export const POC2_SITES = [
  'crawlmouse.com', 'nahltech.com', 'deathwishcoffee.com', 'brooklinen.com', 'yoast.com',
  'screamingfrog.co.uk', 'indyhub.org', 'hashnode.com', 'smashingmagazine.com', 'backlinko.com',
] as const;
export const DISCRIMINATOR_SITES = ['nike.com', 'en.wikipedia.org', 'css-tricks.com', 'neilpatel.com', 'cnn.com'] as const;
export const SLOW_HOST_SITE = 'yoast.com';

export function parseArgs(argv: string[]): { scenario: string; flags: Record<string, string> } {
  const [scenario = '', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (const a of rest) {
    const m = a.match(/^--([a-z][a-z0-9-]*)=(.*)$/);
    if (m) flags[m[1]!] = m[2]!;
    else if (a.startsWith('--')) flags[a.slice(2)] = 'true';
  }
  return { scenario, flags };
}

export function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
}

export function extractHrefs(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1]!, base);
      u.hash = '';
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname === new URL(base).hostname) out.push(u.toString());
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Homepage first, then candidates in an order fixed by their hash, so reruns pick the same pages. */
export function pickSample(origin: string, candidates: string[], n: number): string[] {
  const home = `${origin.replace(/\/$/, '')}/`;
  const seen = new Set<string>([home]);
  const rest: string[] = [];
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    rest.push(c);
  }
  rest.sort((a, b) => createHash('sha256').update(a).digest('hex').localeCompare(createHash('sha256').update(b).digest('hex')));
  return [home, ...rest].slice(0, n);
}

export interface Secrets {
  signing: string;
  jwt: string;
}

export function newNonce(): string {
  return randomBytes(12).toString('base64url');
}

export function buildBatch(i: {
  checkId: string;
  batch: number;
  kind: 'crawl' | 'access';
  urls: string[];
  hostPolicy?: Partial<BatchRequest['hostPolicy']>;
  jwtSecret: string;
  now?: number;
  stage?: 1 | 2;
}): BatchRequest {
  const nonce = newNonce();
  const now = i.now ?? Date.now();
  const jwt = signJwt({ check_id: i.checkId, batch: i.batch, nonce, role: 'crawl_worker', iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 900 }, i.jwtSecret);
  return {
    checkId: i.checkId,
    batch: i.batch,
    batchId: `${i.checkId}:${i.batch}`,
    nonce,
    kind: i.kind,
    urls: i.urls.map((url, k) => ({ url, hash: String(k), depth: 1 })),
    hostPolicy: { rps: 2, ...i.hostPolicy },
    stage: i.stage,
    jwt,
  };
}

export async function postBatch(workerUrl: string, secret: string, req: BatchRequest): Promise<number> {
  const raw = JSON.stringify(req);
  const ts = String(Date.now());
  const res = await fetch(`${workerUrl}/batch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-crawlmouse-ts': ts,
      'x-crawlmouse-signature': signBatch({ ts, checkId: req.checkId, batch: req.batch, nonce: req.nonce, body: raw, secret }),
    },
    body: raw,
  });
  await res.arrayBuffer();
  return res.status;
}

export interface Outcome {
  counters: { fetched: number; newUrls: number; blocked: number; bytes: number; partial: boolean };
  rows: Row[];
  skipped: Record<string, number>;
  limiter: Record<string, { started: number; maxInFlight: number; slowRuleFiredAtMs: number | null; gapMs: number }>;
  wallMs: number;
}

export async function getSigned(workerUrl: string, secret: string, path: string, purpose: string): Promise<Response> {
  const ts = String(Date.now());
  return fetch(`${workerUrl}${path}`, { headers: { 'x-crawlmouse-ts': ts, 'x-crawlmouse-signature': signTs({ ts, purpose, secret }) } });
}

export async function waitOutcome(workerUrl: string, secret: string, checkId: string, batch: number, timeoutMs: number, pollMs = 1000): Promise<Outcome> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = await getSigned(workerUrl, secret, `/results/${checkId}/${batch}`, `results:${checkId}:${batch}`);
    if (r.status === 200) return (await r.json()) as Outcome;
    await r.arrayBuffer();
    if (Date.now() > until) throw new Error(`batch ${checkId}:${batch} not finished within ${timeoutMs} ms`);
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

/** Run one batch and wait for it. The caller supplies a fresh checkId per scenario run. */
export async function runBatchAndWait(workerUrl: string, secrets: Secrets, i: Omit<Parameters<typeof buildBatch>[0], 'jwtSecret'> & { timeoutMs?: number }): Promise<Outcome> {
  const req = buildBatch({ ...i, jwtSecret: secrets.jwt });
  const status = await postBatch(workerUrl, secrets.signing, req);
  if (status !== 202) throw new Error(`worker answered ${status} to batch ${i.batch}`);
  return waitOutcome(workerUrl, secrets.signing, i.checkId, i.batch, i.timeoutMs ?? 8 * 60_000);
}

/** Spec 2.1 / 2.2: requests per second the host saw, from the worker's own counts. */
export function throughputRow(site: string, outcomes: Outcome[], elapsedMs: number): Row {
  const host = Object.keys(outcomes[0]?.limiter ?? {})[0] ?? site;
  const requests = outcomes.reduce((n, o) => n + (o.limiter[host]?.started ?? 0), 0);
  const last = outcomes.at(-1)?.limiter[host];
  const sampled = outcomes.reduce((n, o) => n + o.counters.fetched, 0);
  const known = outcomes.reduce((n, o) => n + o.counters.fetched + Object.values(o.skipped).reduce((a, b) => a + b, 0), 0);
  const seconds = elapsedMs / 1000;
  return {
    kind: 'throughput',
    site,
    host,
    requests: last?.started ?? requests,
    seconds: Math.round(seconds * 10) / 10,
    reqPerSec: Math.round(((last?.started ?? requests) / seconds) * 100) / 100,
    maxInFlight: last?.maxInFlight ?? null,
    slowRuleFiredAtMs: last?.slowRuleFiredAtMs ?? null,
    gapMs: last?.gapMs ?? null,
    sampled,
    known,
    partial: outcomes.some((o) => o.counters.partial),
  };
}

export async function runDiscriminatorSite(
  workerUrl: string,
  secrets: Secrets,
  site: SiteName,
  urls: string[],
  checkId: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  const stage1 = await runBatchAndWait(workerUrl, secrets, { checkId, batch: 1, kind: 'access', urls, stage: 1, hostPolicy: { rps: 2, ceilingS: 480 } });
  const access = stage1.rows.filter((r) => r.kind === 'access');
  const pages = access.map((r) =>
    Object.fromEntries(CRAWLER_TOKENS.map((t) => [t, { verdict: r[`v:${t}`] as Verdict, row: r[`row:${t}`], scored: true }])),
  );
  const summary = summarize(pages as never);
  const m = matchesExpectation(site, summary);
  for (const t of CRAWLER_TOKENS) {
    for (const [verdict, count] of Object.entries(summary[t])) {
      rows.push({ kind: 'verdict', site, token: t, verdict, count, of: access.length });
    }
  }
  rows.push({ kind: 'summary', site, pass: m.ok, count: m.misses.length, of: access.length });
  return rows;
}

export async function runSsrfCases(workerUrl: string, secrets: Secrets, fixtureBase: string | undefined, checkId: string): Promise<Row[]> {
  const rows: Row[] = [];
  let batch = 0;
  for (const c of SSRF_CASES) {
    if (c.target.kind === 'fixture' && !fixtureBase) {
      rows.push({ kind: 'ssrf', case: c.id, expect: c.expect, result: 'not_run', reason: 'no --fixture-base' });
      continue;
    }
    const url = c.target.kind === 'absolute' ? c.target.url : `${fixtureBase}${c.target.path}`;
    batch++;
    const o = await runBatchAndWait(workerUrl, secrets, { checkId, batch, kind: 'crawl', urls: [url], hostPolicy: { rps: 2 }, timeoutMs: 120_000 });
    const row = o.rows.find((r) => r.kind === 'crawl');
    const error = String(row?.error ?? '');
    const result = error === 'ssrf_refused' ? 'refused' : error === 'too_large' ? 'truncated' : row?.outcome === 'fetched' ? 'fetched' : error || 'other';
    rows.push({ kind: 'ssrf', case: c.id, expect: c.expect, result, pass: result === c.expect, bytes: row?.bytes ?? null });
  }
  return rows;
}

/** Spec 2.7: the five completion-route cases. `open` registers the batch row (rehearsal fixture only). */
export async function runCompletionCases(
  completionUrl: string,
  jwtSecret: string,
  open?: (i: { checkId: string; batch: number; nonce: string }) => Promise<void>,
  eventCount?: () => Promise<number>,
): Promise<Row[]> {
  const rows: Row[] = [];
  const counters = { fetched: 1, newUrls: 0, blocked: 0, bytes: 1, partial: false };
  const mk = (checkId: string, batch: number, nonce: string, expOffsetS = 900, claimBatch = batch) => ({
    jwt: signJwt({ check_id: checkId, batch: claimBatch, nonce, role: 'crawl_worker', exp: Math.floor(Date.now() / 1000) + expOffsetS }, jwtSecret),
    body: JSON.stringify({ checkId, batch, nonce, counters }),
  });
  const call = async (p: { jwt: string; body: string }) => {
    const r = await fetch(`${completionUrl}/api/internal/batch-done`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.jwt}` },
      body: p.body,
    });
    await r.arrayBuffer();
    return r.status;
  };
  const record = (id: string, want: string, got: unknown, pass: boolean) => rows.push({ kind: 'completion', case: id, expect: want, result: String(got), pass });
  const id = newNonce().replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8);

  const n1 = `nonce-${id}-1aaa`;
  await open?.({ checkId: id, batch: 1, nonce: n1 });
  const first = mk(id, 1, n1);
  const a = await call(first);
  record('valid-accepted-once', '200', a, a === 200);
  const b = await call(first);
  record('replayed-refused', '409', b, b === 409);

  const n2 = `nonce-${id}-2bbb`;
  await open?.({ checkId: id, batch: 2, nonce: n2 });
  const c = await call(mk(id, 2, n2, -5));
  record('expired-refused', '401', c, c === 401);

  const n3 = `nonce-${id}-3ccc`;
  await open?.({ checkId: id, batch: 3, nonce: n3 });
  const d = await call(mk(id, 3, n3, 900, 2));
  record('batch2-jwt-on-batch3-refused', '403', d, d === 403);

  const n4 = `nonce-${id}-4ddd`;
  await open?.({ checkId: id, batch: 4, nonce: n4 });
  const twin = mk(id, 4, n4);
  const both = await Promise.all([call(twin), call(twin)]);
  const applied = both.filter((s) => s === 200).length;
  record('simultaneous-applies-once', 'one 200', both.join('+'), applied === 1);
  if (eventCount) {
    const events = await eventCount();
    rows.push({ kind: 'completion', case: 'events-sent', expect: '2', result: String(events), pass: events === 2 });
  }
  return rows;
}
