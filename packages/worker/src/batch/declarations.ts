import {
  DECLARATION_PATHS,
  DeclarationFetchSchema,
  type DeclarationFetch,
  type DeclarationPath,
} from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';
import { CRAWL } from '../identities.js';
import { oursAllow } from '../politeness/robots.js';
import { bounded, CAPS } from '../rows/bounded.js';
import { standardStatus } from '../rows/evidence.js';
import { politeFetch, type FetchContext, type NotRequested } from './polite-fetch.js';
import { ROBOTS_TTL_MS, type BatchRobots, type SiteBlock } from './site-rules.js';

/**
 * The declaration files (DECLARATION_PATHS): in each crawl batch, after its pages, on the origin of
 * the batch's first URL, each requested as our crawler through the batch's limiter and budget like
 * any request. Each is recorded as status, media type and byte count only.
 *
 * Bounded so a site cannot make the batch do more for them: seven requests at most, the pages first
 * (a spent budget leaves the declarations unrequested, never a page), a body read no further than
 * DECLARATION_KEEP_BYTES, no redirect followed (a 3xx is recorded as it answered), and a 429 that
 * does not count towards stopping the site, so a rate-limited path cannot stop the crawl of its pages.
 * What an origin answered is kept (DeclarationCache), so the batches of one check ask once in that
 * time, not once each; a transient answer (408, 425, 429, 5xx) for its Retry-After. Nothing of the body leaves this module.
 */

/** How much of a declaration body is read; past it the count is `bytes_complete: false`. */
export const DECLARATION_KEEP_BYTES = 64 * 1024;
/** Origins whose answers are kept at once; the oldest goes first. */
export const DECLARATION_CACHE_ORIGINS = 1000;
/** The least time a 429 or a 5xx answer is kept: a server that asks us to wait gets at least this. */
export const DECLARATION_BACKOFF_MS = 60_000;

type Answer = Omit<DeclarationFetch, 'from_cache'>;

/**
 * A Retry-After value in milliseconds from `now`: delta-seconds or an HTTP date (RFC 9110 §10.2.3);
 * null for anything else.
 */
export function retryAfterMs(value: string | undefined, now: number): number | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (/^\d{1,10}$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Answers that say how the server was at that moment, not what the file is (RFC 9110, RFC 6585). */
export const isTransient = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

/**
 * How long an answer is kept. A file's answer, ROBOTS_TTL_MS, as robots.txt is. A transient one
 * (408, 425, 429 or a 5xx) for its Retry-After, at least DECLARATION_BACKOFF_MS and at most
 * ROBOTS_TTL_MS, so a path the server asked us to wait on is not asked again in the next batch.
 */
export function keepFor(status: number, retryAfter: number | null): number {
  if (!isTransient(status)) return ROBOTS_TTL_MS;
  return Math.min(ROBOTS_TTL_MS, Math.max(DECLARATION_BACKOFF_MS, retryAfter ?? 0));
}

/**
 * What each origin answered, kept across batches, each answer for its own time (keepFor). A request
 * that failed, or was not made, is not kept: the next batch asks again.
 */
export class DeclarationCache {
  private readonly entries = new Map<
    string,
    Map<DeclarationPath, { answer: Answer; until: number }>
  >();

  constructor(private readonly clock: Clock) {}

  get(origin: string, path: DeclarationPath): Answer | null {
    const hit = this.entries.get(origin)?.get(path);
    return hit && this.clock.now() < hit.until ? hit.answer : null;
  }

  set(origin: string, answer: Answer, keepMs: number): void {
    let answers = this.entries.get(origin);
    if (!answers) {
      answers = new Map();
      this.entries.set(origin, answers);
      // In the order they were first set: the first is the oldest.
      while (this.entries.size > DECLARATION_CACHE_ORIGINS)
        this.entries.delete(this.entries.keys().next().value!);
    }
    answers.set(answer.path, { answer, until: this.clock.now() + keepMs });
  }
}

export interface DeclarationRun {
  ctx: FetchContext;
  clock: Clock;
  robots: BatchRobots;
  /** Set when robots.txt, or the batch itself, kept every page from being requested. */
  blocked: SiteBlock | NotRequested | null;
  cache: DeclarationCache;
}

const notRequested = (
  origin: string,
  path: DeclarationPath,
  why: DeclarationFetch['not_requested'],
): DeclarationFetch =>
  DeclarationFetchSchema.parse({
    origin,
    path,
    state: 'not_requested',
    status: null,
    media_type: null,
    bytes: null,
    bytes_complete: null,
    not_requested: why,
    from_cache: false,
  });

export async function fetchDeclarations(
  run: DeclarationRun,
  firstUrl: string,
): Promise<DeclarationFetch[]> {
  const origin = new URL(firstUrl).origin;
  // Requested at `origin`; recorded within the contract's budget, which an origin never exceeds.
  const recorded = bounded(origin, CAPS.origin);
  const blocked = run.blocked;
  if (blocked !== null) {
    const reason = 'reason' in blocked ? why(blocked) : 'site_blocked';
    return DECLARATION_PATHS.map((p) => notRequested(recorded, p, reason));
  }
  const rules = await run.robots.forUrl(firstUrl);
  if ('reason' in rules) return DECLARATION_PATHS.map((p) => notRequested(recorded, p, why(rules)));
  const parsed = rules.reading.state === 'rules' ? rules.reading.rules : null;
  const out: DeclarationFetch[] = [];
  for (const path of DECLARATION_PATHS) {
    if (!oursAllow(parsed, path)) {
      out.push(notRequested(recorded, path, 'robots_disallowed'));
      continue;
    }
    const kept = run.cache.get(origin, path);
    if (kept) {
      out.push(DeclarationFetchSchema.parse({ ...kept, from_cache: true }));
      continue;
    }
    const r = await politeFetch(run.ctx, `${origin}${path}`, CRAWL, {
      offSite: 'stop',
      keepBytes: DECLARATION_KEEP_BYTES,
      follow: false,
      countsTowardStop: false,
    });
    if ('notRequested' in r) {
      out.push(notRequested(recorded, path, why(r.notRequested)));
      continue;
    }
    const f = r.fetch;
    // A status outside 100-599 (LinkedIn's 999) is not one the contract holds: no usable answer.
    const status = standardStatus(f.status);
    const answered = status !== null;
    const type = f.headers['content-type'];
    const record = DeclarationFetchSchema.parse({
      origin: recorded,
      path,
      state: answered ? 'answered' : 'no_response',
      status,
      media_type: answered && type !== undefined ? bounded(String(type), CAPS.mediaType) : null,
      // Past the keep limit the read stopped, so the count is not the whole body.
      bytes: answered ? f.bytes : null,
      bytes_complete: answered ? !f.bodyCut : null,
      not_requested: null,
      from_cache: false,
    });
    if (answered) {
      const after = f.headers['retry-after'];
      const wait = retryAfterMs(Array.isArray(after) ? after[0] : after, run.clock.now());
      run.cache.set(origin, record, keepFor(status, wait));
    }
    out.push(record);
  }
  return out;
}

const why = (n: NotRequested): DeclarationFetch['not_requested'] =>
  n.reason === 'budget' ? 'budget' : 'site_stopped';
