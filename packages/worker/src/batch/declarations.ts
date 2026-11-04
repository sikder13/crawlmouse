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
 * What an origin answered is kept for ROBOTS_TTL_MS (DeclarationCache), so the batches of one check
 * ask once in that time, not once each. Nothing of the body leaves this module.
 */

/** How much of a declaration body is read; past it the count is `bytes_complete: false`. */
export const DECLARATION_KEEP_BYTES = 64 * 1024;
/** Origins whose answers are kept at once; the oldest goes first. */
export const DECLARATION_CACHE_ORIGINS = 1000;

type Answer = Omit<DeclarationFetch, 'from_cache'>;

/**
 * What each origin answered, kept across batches for ROBOTS_TTL_MS, as robots.txt is. Only answers
 * that say what the file is: a request that failed, was not made, or got a 429 or a 5xx is asked
 * again by the next batch.
 */
export class DeclarationCache {
  private readonly entries = new Map<
    string,
    { at: number; answers: Map<DeclarationPath, Answer> }
  >();

  constructor(private readonly clock: Clock) {}

  get(origin: string, path: DeclarationPath): Answer | null {
    const hit = this.entries.get(origin);
    if (!hit || this.clock.now() - hit.at >= ROBOTS_TTL_MS) return null;
    return hit.answers.get(path) ?? null;
  }

  set(origin: string, answer: Answer): void {
    let hit = this.entries.get(origin);
    if (!hit || this.clock.now() - hit.at >= ROBOTS_TTL_MS) {
      this.entries.delete(origin);
      hit = { at: this.clock.now(), answers: new Map() };
      this.entries.set(origin, hit);
      // In the order they were set: the first is the oldest.
      while (this.entries.size > DECLARATION_CACHE_ORIGINS)
        this.entries.delete(this.entries.keys().next().value!);
    }
    hit.answers.set(answer.path, answer);
  }
}

export interface DeclarationRun {
  ctx: FetchContext;
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
    // A 429 or a 5xx says how the server was at that moment, not what the file is: asked again.
    if (answered && status !== 429 && status! < 500) run.cache.set(origin, record);
    out.push(record);
  }
  return out;
}

const why = (n: NotRequested): DeclarationFetch['not_requested'] =>
  n.reason === 'budget' ? 'budget' : 'site_stopped';
