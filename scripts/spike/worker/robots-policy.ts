import { parseRobotsTxt, isAllowedByRobots, type ParsedRobots } from '../../../packages/engine/src/robots.js';
import { OUR_ROBOTS_TOKENS } from './identities.js';

/**
 * robots.txt for the worker. Our two product tokens are `Crawlmouse` and `CrawlmouseBot` (ENGINE-GAP 8.7, U14).
 * The engine parser and matcher are reused unchanged; what lives here is the part the engine does not do:
 * normalising bytes as served (BOM, CR-only line endings), picking the group that applies to a pair of tokens,
 * and the RFC 9309 answer to an unavailable file.
 */

export const MAX_ROBOTS_BYTES = 512 * 1024;
export const FLOOR_GAP_MS = 500;

export function parseRobotsBody(text: string): ParsedRobots {
  const capped = Buffer.byteLength(text) > MAX_ROBOTS_BYTES ? Buffer.from(text).subarray(0, MAX_ROBOTS_BYTES).toString('utf8') : text;
  // The engine splits on \r?\n only, so a CR-only file would be one line. Normalise first.
  return parseRobotsTxt(capped.replace(/\r\n?/g, '\n'));
}

function presentGroups(r: ParsedRobots): string[] {
  return OUR_ROBOTS_TOKENS.filter((t) => r.rules[t] !== undefined);
}

/** Allowed iff every group of ours that exists allows the path; with none, the `*` group decides. */
export function allowedForOurTokens(r: ParsedRobots | null, pathAndQuery: string): boolean {
  if (!r) return true;
  const groups = presentGroups(r);
  if (groups.length === 0) return isAllowedByRobots(r, '*', pathAndQuery);
  return groups.every((t) => isAllowedByRobots(r, t, pathAndQuery));
}

export function crawlDelayForOurTokens(r: ParsedRobots | null): number | undefined {
  if (!r) return undefined;
  const groups = presentGroups(r);
  const delays = (groups.length ? groups : ['*']).map((g) => r.rules[g]?.crawlDelay).filter((d): d is number => d !== undefined);
  return delays.length ? Math.max(...delays) : undefined;
}

/** Is `token` allowed on this path, with `*` as the fallback group (access-test identities). */
export function allowedForToken(r: ParsedRobots | null, token: string, pathAndQuery: string): boolean {
  return r ? isAllowedByRobots(r, token, pathAndQuery) : true;
}

/** gap = max(500 ms, d_ours, max over tokens in play of d_X). A declared delay is never shortened. */
export function hostGapMs(r: ParsedRobots | null, tokensInPlay: readonly string[]): number {
  let gap = FLOOR_GAP_MS;
  const ours = crawlDelayForOurTokens(r);
  if (ours !== undefined) gap = Math.max(gap, ours * 1000);
  if (r) {
    for (const t of tokensInPlay) {
      const d = (r.rules[t.toLowerCase()] ?? undefined)?.crawlDelay;
      if (d !== undefined) gap = Math.max(gap, d * 1000);
    }
  }
  return gap;
}

export interface RobotsLoad {
  state: 'rules' | 'absent' | 'unreachable';
  parsed: ParsedRobots | null;
  status?: number;
  bytes?: number;
  /** Why the file could not be read (an error class), when state is 'unreachable' because of a thrown error. */
  cause?: string;
}

const DENY_ALL: ParsedRobots = { sitemaps: [], rules: { '*': { disallow: ['/'], allow: [] } } };

export async function loadRobots(
  origin: string,
  fetchText: (url: string) => Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>,
): Promise<RobotsLoad> {
  let res;
  try {
    res = await fetchText(`${origin.replace(/\/$/, '')}/robots.txt`);
  } catch (e) {
    return { state: 'unreachable', parsed: DENY_ALL, cause: e instanceof Error ? e.message : 'unknown' };
  }
  if (res.status >= 500) return { state: 'unreachable', parsed: DENY_ALL, status: res.status };
  if (res.status >= 400 || res.status < 200 || res.status >= 300) return { state: 'absent', parsed: null, status: res.status };
  const ct = String(res.headers['content-type'] ?? '').toLowerCase();
  // text/plain is the normal type and must be read. An HTML 200 is a soft 404 page, not a rules file.
  if (ct.includes('html')) return { state: 'absent', parsed: null, status: res.status };
  return { state: 'rules', parsed: parseRobotsBody(res.body), status: res.status, bytes: Buffer.byteLength(res.body) };
}
