import {
  DECLARATION_PATHS,
  DeclarationFetchSchema,
  type DeclarationFetch,
  type DeclarationPath,
} from '@crawlmouse/types/v2';
import { CRAWL } from '../identities.js';
import { oursAllow } from '../politeness/robots.js';
import { bounded, CAPS } from '../rows/bounded.js';
import { standardStatus } from '../rows/evidence.js';
import { politeFetch, type FetchContext, type NotRequested } from './polite-fetch.js';
import type { BatchRobots, SiteBlock } from './site-rules.js';

/**
 * The declaration files (DECLARATION_PATHS): once per crawl batch, after its pages, on the origin of
 * the batch's first URL, each requested as our crawler through the batch's limiter and budget like
 * any request. Each is recorded as status, media type and byte count only.
 *
 * Bounded so a site cannot make the batch do more for them: seven requests at most, the pages first
 * (a spent budget leaves the declarations unrequested, never a page), a body read no further than
 * DECLARATION_KEEP_BYTES, and no redirect followed (a 3xx is recorded as it answered). Nothing of the
 * body leaves this module.
 */

/** How much of a declaration body is read; past it the count is `bytes_complete: false`. */
export const DECLARATION_KEEP_BYTES = 64 * 1024;

export interface DeclarationRun {
  ctx: FetchContext;
  robots: BatchRobots;
  /** Set when robots.txt, or the batch itself, kept every page from being requested. */
  blocked: SiteBlock | NotRequested | null;
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
  });

export async function fetchDeclarations(
  run: DeclarationRun,
  firstUrl: string,
): Promise<DeclarationFetch[]> {
  const origin = bounded(new URL(firstUrl).origin, CAPS.origin);
  if (run.blocked !== null)
    return DECLARATION_PATHS.map((p) => notRequested(origin, p, 'site_blocked'));
  const rules = await run.robots.forUrl(firstUrl);
  if ('reason' in rules) return DECLARATION_PATHS.map((p) => notRequested(origin, p, why(rules)));
  const parsed = rules.reading.state === 'rules' ? rules.reading.rules : null;
  const out: DeclarationFetch[] = [];
  for (const path of DECLARATION_PATHS) {
    if (!oursAllow(parsed, path)) {
      out.push(notRequested(origin, path, 'robots_disallowed'));
      continue;
    }
    const r = await politeFetch(run.ctx, `${origin}${path}`, CRAWL, {
      offSite: 'stop',
      keepBytes: DECLARATION_KEEP_BYTES,
      follow: false,
    });
    if ('notRequested' in r) {
      out.push(notRequested(origin, path, why(r.notRequested)));
      continue;
    }
    const f = r.fetch;
    // A status outside 100-599 (LinkedIn's 999) is not one the contract holds: no usable answer.
    const status = standardStatus(f.status);
    const answered = status !== null;
    const type = f.headers['content-type'];
    out.push(
      DeclarationFetchSchema.parse({
        origin,
        path,
        state: answered ? 'answered' : 'no_response',
        status,
        media_type: answered && type !== undefined ? bounded(String(type), CAPS.mediaType) : null,
        // Decoded bytes read: past the keep limit the read stopped, so the count is not the whole.
        bytes: answered ? f.bytes : null,
        bytes_complete: answered ? !f.bodyCut : null,
        not_requested: null,
      }),
    );
  }
  return out;
}

const why = (n: NotRequested): DeclarationFetch['not_requested'] =>
  n.reason === 'budget' ? 'budget' : 'site_stopped';
