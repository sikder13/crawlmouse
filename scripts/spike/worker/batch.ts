import { createHash } from 'node:crypto';
import { HostLimiter } from './limiter.js';
import type { Fetcher, FetchRecord } from './fetcher.js';
import {
  loadRobots,
  allowedForOurTokens,
  allowedForToken,
  hostGapMs,
  crawlDelayForOurTokens,
  type RobotsLoad,
} from './robots-policy.js';
import { CRAWLER_TOKENS, type Token } from './identities.js';
import {
  classifyControl,
  classifyPage,
  classifyResponse,
  gFromU,
  type PageObs,
  type RobotsVerdict,
  type UResult,
} from './classify.js';
import type { BatchCounters } from './completion.js';

export interface BatchUrl {
  url: string;
  hash: string;
  depth: number;
}

export interface HostPolicy {
  rps: number;
  gapMs?: number;
  inFlight?: number;
  requestCap?: number;
  ceilingS?: number;
  /** Epoch ms; while it is in the future every URL is skipped. */
  pauseUntil?: number;
}

export interface BatchRequest {
  checkId: string;
  batch: number;
  batchId: string;
  nonce: string;
  kind: 'crawl' | 'access';
  urls: BatchUrl[];
  hostPolicy: HostPolicy;
  stage?: 1 | 2;
  jwt: string;
}

export type ResultRow = Record<string, string | number | boolean | null>;

export interface BatchOutcome {
  counters: BatchCounters;
  rows: ResultRow[];
  skipped: Record<string, number>;
  limiter: Record<string, { started: number; maxInFlight: number; slowRuleFiredAtMs: number | null; gapMs: number }>;
  wallMs: number;
}

export interface BatchDeps {
  fetch: Fetcher;
  limiters: Map<string, HostLimiter>;
  robotsCache: Map<string, { at: number; load: RobotsLoad }>;
  now?: () => number;
  /** TEST ONLY: builds the limiter for a host. Production leaves it unset. */
  limiterFactory?: (host: string) => HostLimiter;
}

const ROBOTS_TTL_MS = 10 * 60_000;
const DEFAULT_CEILING_S = 360;

export const urlHash = (u: string): string => createHash('sha256').update(u).digest('hex').slice(0, 12);

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function pathOf(u: string): string {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return '/';
  }
}

function sameHostLinks(html: string, base: string): Set<string> {
  const out = new Set<string>();
  const host = hostOf(base);
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1]!, base);
      u.hash = '';
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.toLowerCase() === host) out.add(u.origin + u.pathname + u.search);
    } catch {
      /* ignore */
    }
  }
  return out;
}

export async function runBatch(req: BatchRequest, deps: BatchDeps): Promise<BatchOutcome> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  const policy = req.hostPolicy;
  const deadline = t0 + (policy.ceilingS ?? DEFAULT_CEILING_S) * 1000;
  const cap = policy.requestCap ?? Number.POSITIVE_INFINITY;
  const rows: ResultRow[] = [];
  const skipped: Record<string, number> = {};
  let requests = 0;
  let bytes = 0;
  let fetched = 0;
  let blocked = 0;
  let partial = false;
  const newUrls = new Set<string>();
  const hostsSeen = new Set<string>();
  let hostPaused = false;
  let robotsStoppedByBudget = false;

  const skip = (reason: string, n = 1) => {
    skipped[reason] = (skipped[reason] ?? 0) + n;
    partial = true;
  };

  const limiterFor = (host: string): HostLimiter => {
    let l = deps.limiters.get(host);
    if (!l) {
      l = deps.limiterFactory?.(host) ?? new HostLimiter({ rps: Math.min(policy.rps || 2, 2) });
      deps.limiters.set(host, l);
    }
    return l;
  };

  /** One budgeted, rate-limited fetch. Returns null when the budget says stop. */
  const budgeted = async (host: string, url: string, who: Parameters<Fetcher>[1]): Promise<FetchRecord | null> => {
    if (hostPaused) return null;
    return limiterFor(host).run(async () => {
      if (hostPaused || now() > deadline) return null;
      if (requests >= cap) return null;
      requests++;
      const rec = await deps.fetch(url, who);
      bytes += rec.bytes;
      if (rec.status === 429) hostPaused = true;
      return rec;
    });
  };

  const robotsFor = async (url: string): Promise<RobotsLoad> => {
    const origin = new URL(url).origin;
    const hit = deps.robotsCache.get(origin);
    if (hit && now() - hit.at < ROBOTS_TTL_MS) return hit.load;
    const host = hostOf(url);
    const load = await loadRobots(origin, async (u) => {
      const rec = await budgeted(host, u, 'crawlmouse');
      if (!rec) {
        robotsStoppedByBudget = true;
        throw new Error('budget');
      }
      if (rec.errorClass) throw new Error(rec.errorClass);
      return { status: rec.status, body: rec.body, headers: rec.shape.headers };
    });
    if (!robotsStoppedByBudget) deps.robotsCache.set(origin, { at: now(), load });
    return load;
  };

  const first = req.urls[0];
  if (!first) return finish();
  if (policy.pauseUntil && policy.pauseUntil > now()) {
    skip('host_paused', req.urls.length);
    return finish();
  }

  // One host per batch in practice; robots and the limiter are configured from the first URL's host.
  const host0 = hostOf(first.url);
  hostsSeen.add(host0);
  const tokensInPlay = req.kind === 'access' ? [...CRAWLER_TOKENS.map((t) => t.toLowerCase()), 'googlebot'] : [];
  let robots: RobotsLoad;
  try {
    robots = await robotsFor(first.url);
  } catch {
    robots = { state: 'unreachable', parsed: null };
  }
  if (robotsStoppedByBudget) {
    skip(hostPaused ? 'host_429' : requests >= cap ? 'request_cap' : 'ceiling', req.urls.length);
    return finish();
  }
  const l0 = limiterFor(host0);
  const declaredGap = Math.max(policy.gapMs ?? 0, hostGapMs(robots.parsed, tokensInPlay));
  l0.setCrawlDelayMs(declaredGap > 500 ? declaredGap : 0);
  rows.push({
    kind: 'robots',
    host: host0,
    state: robots.state,
    status: robots.status ?? null,
    bytes: robots.bytes ?? null,
    crawlDelayS: crawlDelayForOurTokens(robots.parsed) ?? null,
    gapMs: l0.gapMs(),
  });

  if (robots.state === 'unreachable' && robots.cause === 'ssrf_refused') {
    // The guard refused the host itself. Report it as a refusal, not as a robots decision.
    for (const u of req.urls) {
      blocked++;
      rows.push({ kind: req.kind, host: hostOf(u.url), urlHash: urlHash(u.url), outcome: 'error', error: 'ssrf_refused' });
    }
    return finish();
  }
  if (req.kind === 'crawl') {
    await Promise.all(
      req.urls.map(async (u) => {
        const host = hostOf(u.url);
        hostsSeen.add(host);
        if (!allowedForOurTokens(robots.parsed, pathOf(u.url))) {
          blocked++;
          rows.push({ kind: 'crawl', host, urlHash: urlHash(u.url), outcome: 'robots_blocked' });
          return;
        }
        const rec = await budgeted(host, u.url, 'crawlmouse');
        if (!rec) {
          skip(hostPaused ? 'host_429' : requests >= cap ? 'request_cap' : 'ceiling');
          rows.push({ kind: 'crawl', host, urlHash: urlHash(u.url), outcome: 'skipped' });
          return;
        }
        if (rec.errorClass === 'ssrf_refused') blocked++;
        else if (!rec.errorClass) fetched++;
        for (const l of sameHostLinks(rec.body, u.url)) newUrls.add(l);
        rows.push({
          kind: 'crawl',
          host,
          urlHash: urlHash(u.url),
          outcome: rec.errorClass ? 'error' : 'fetched',
          status: rec.status,
          ms: rec.ms,
          bytes: rec.bytes,
          words: rec.words,
          hops: rec.hops,
          error: rec.errorClass ?? null,
        });
      }),
    );
  } else {
    for (const u of req.urls) {
      const host = hostOf(u.url);
      hostsSeen.add(host);
      const path = pathOf(u.url);
      const isHome = path === '/' || path === '';
      const browser = await budgeted(host, u.url, 'browser');
      const ours = await budgeted(host, u.url, 'crawlmouse');
      if (!browser || !ours) {
        skip(hostPaused ? 'host_429' : requests >= cap ? 'request_cap' : 'ceiling');
        continue;
      }
      const K = classifyControl([browser.shape, ours.shape]);
      const R = {} as Record<Token, RobotsVerdict>;
      const U = {} as Record<Token, UResult>;
      const words = {} as Record<Token, number>;
      const ms: Record<string, number> = {};
      for (const t of CRAWLER_TOKENS) {
        R[t] = allowedForToken(robots.parsed, t.toLowerCase(), path) ? 'allowed' : 'disallowed';
        if (R[t] === 'disallowed') {
          U[t] = 'not_fetched';
          words[t] = 0;
          continue;
        }
        const rec = await budgeted(host, u.url, t);
        if (!rec) {
          U[t] = 'not_fetched';
          words[t] = 0;
          skip(hostPaused ? 'host_429' : requests >= cap ? 'request_cap' : 'ceiling');
          continue;
        }
        U[t] = rec.errorClass ? 'error' : classifyResponse(rec.shape);
        words[t] = rec.words;
        ms[t] = rec.ms;
        fetched++;
      }
      const noneServed = CRAWLER_TOKENS.every((t) => U[t] !== 'served');
      let G: PageObs['G'] = 'not_run';
      if ((isHome || noneServed) && allowedForToken(robots.parsed, 'googlebot', path)) {
        const g = await budgeted(host, u.url, 'googlebot');
        if (g) {
          G = g.errorClass ? 'not_run' : gFromU(classifyResponse(g.shape));
          ms.googlebot = g.ms;
        }
      }
      const obs: PageObs = { robots: R, K, controlWords: ours.words, U, words, G };
      const decisions = classifyPage(obs);
      const row: ResultRow = {
        kind: 'access',
        host,
        urlHash: urlHash(u.url),
        K,
        G,
        controlWords: ours.words,
        browserMs: browser.ms,
        crawlmouseMs: ours.ms,
      };
      for (const t of CRAWLER_TOKENS) {
        row[`u:${t}`] = U[t];
        row[`v:${t}`] = decisions[t].verdict;
        row[`row:${t}`] = decisions[t].row;
        row[`words:${t}`] = words[t];
        row[`ms:${t}`] = ms[t] ?? null;
      }
      blocked += CRAWLER_TOKENS.filter((t) => R[t] === 'disallowed').length;
      rows.push(row);
    }
  }
  return finish();

  function finish(): BatchOutcome {
    const limiter: BatchOutcome['limiter'] = {};
    for (const h of hostsSeen) {
      const l = deps.limiters.get(h);
      if (l) limiter[h] = { ...l.stats(), gapMs: l.gapMs() };
    }
    return {
      counters: { fetched, newUrls: newUrls.size, blocked, bytes, partial },
      rows,
      skipped,
      limiter,
      wallMs: now() - t0,
    };
  }
}
