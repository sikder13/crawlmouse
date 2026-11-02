import {
  ROBOTS_PARSE_LIMIT_BYTES,
  getCrawlDelay,
  isAllowedByRobots,
  parseRobotsTxt,
  type ParsedRobots,
  type RobotsRules,
} from '@crawlmouse/engine/worker';
import type { SearchRobots } from '@crawlmouse/types/v2';
import type { IncomingHttpHeaders } from 'node:http';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { CANARY, CRAWLERS, OUR_ROBOTS_TOKENS, SEARCH_ENGINES } from '../identities.js';
import { bounded, CAPS } from '../rows/bounded.js';
import { EVIDENCE_HEADERS } from '../rows/evidence.js';
import { challengeOf } from '../verdict/response.js';

/**
 * robots.txt as the worker reads it.
 *
 * The engine's parser and matcher are reused unchanged. What lives here is what the engine does not
 * decide: how a fetch outcome becomes a reading, which groups bind our own requests, and the delay a
 * site declares for the identities in play.
 *
 * - A 4xx means there is no robots.txt: everything is allowed (RFC 9309 "unavailable").
 * - A 5xx, a timeout or a network error means robots.txt is unreachable: the site is treated as fully
 *   disallowed for the batch, and nothing else is fetched (RFC 9309 "unreachable"). So is a file cut
 *   off by what the batch's byte budget had left.
 * - A file larger than MAX_ROBOTS_BYTES, or with more than MAX_ROBOTS_RULES rules in one group the
 *   worker reads, is too large to evaluate: nothing else is fetched either, and the rows say so. The
 *   request for robots.txt reads at most MAX_ROBOTS_REQUEST_BYTES: the limit, and a byte order mark
 *   the limit does not count.
 * - A challenge in place of the file is treated as unreachable too: the rules exist but could not be
 *   read, which is not the same as there being none.
 * - A 200 whose body is an HTML document is a soft 404 (a page, not a rules file): no robots.txt. The
 *   body decides, not the Content-Type, so rules served as text/html are still read.
 * - A redirect chain of more than five hops ends unreachable. RFC 9309 allows reading that as "no
 *   robots.txt"; the stricter reading is used, as for every other read that does not complete.
 * - A refusal by the SSRF guard is not a robots answer at all; the caller reports it as a refusal.
 *
 * A reading holds bounded copies of the groups the worker reads and what a row shows as evidence of
 * the fetch (see evidenceOf). It holds no other part of the file or the response.
 */

/**
 * RFC 9309 has crawlers parse at least 500 KiB; a larger file is not evaluated. It is the engine's
 * parse limit, and counted as the engine counts it: UTF-8 bytes after a leading byte order mark.
 */
export const MAX_ROBOTS_BYTES = ROBOTS_PARSE_LIMIT_BYTES;
/** A UTF-8 byte order mark, which the size does not count. */
const BOM_BYTES = 3;
/** What the request for robots.txt may read: the size limit and a byte order mark. */
export const MAX_ROBOTS_REQUEST_BYTES = MAX_ROBOTS_BYTES + BOM_BYTES;

/** A file's size as MAX_ROBOTS_BYTES counts it. */
const robotsBytes = (body: string): number =>
  Buffer.byteLength(body) - (body.charCodeAt(0) === 0xfeff ? BOM_BYTES : 0);
/** The most rules (Allow and Disallow lines) one group the worker reads may hold. */
export const MAX_ROBOTS_RULES = 5000;

export type UnreachableReason =
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'challenged'
  | 'byte_budget'
  | 'redirect_status';

/** `bytes`: over MAX_ROBOTS_BYTES. `rules`: a group the worker reads holds over MAX_ROBOTS_RULES. */
export type TooLargeReason = 'bytes' | 'rules';

export type RobotsReading =
  | {
      state: 'rules';
      rules: ParsedRobots;
      /**
       * The search engines' groups (lower case) left out of `rules` because one held more than
       * MAX_ROBOTS_RULES rules: their verdicts are not measured. Every other group is kept or absent.
       */
      unevaluated: readonly string[];
      fetch: FetchOutcome;
    }
  | { state: 'none'; why: 'client_error' | 'html_soft_404'; fetch: FetchOutcome }
  | { state: 'unreachable'; why: UnreachableReason; fetch: FetchOutcome }
  | { state: 'too_large'; why: TooLargeReason; fetch: FetchOutcome }
  | { state: 'refused'; fetch: FetchOutcome };

/** The groups the worker ever obeys: ours, `*`, and each identity it sends. */
const READ_AGENTS = new Set(
  [...OUR_ROBOTS_TOKENS, '*', ...CRAWLERS.map((c) => c.robotsToken!), CANARY.robotsToken!].map(
    (t) => t.toLowerCase(),
  ),
);
/**
 * The search engines' groups, read for their verdicts and never obeyed. One that is too large to
 * keep is left out, and its verdicts are not measured; it does not make the file too large to
 * evaluate, as a group the worker obeys does. A token that is also obeyed (Googlebot, the canary's)
 * is in READ_AGENTS, and keeps that stricter rule.
 */
const SEARCH_AGENTS = SEARCH_ENGINES.map((e) => e.robotsToken.toLowerCase()).filter(
  (t) => !READ_AGENTS.has(t),
);

/**
 * The groups the worker reads, copied out of the parsed file so that nothing holds the file; null when
 * a group it obeys has more than MAX_ROBOTS_RULES rules. A search engine's group that large is left
 * out and named in `unevaluated`. A rule that several groups share is copied once, and so is a group
 * several agents share in the file (the parser keeps one object for it): the copy stays one object,
 * so it is held once and matched once (PathMatch).
 */
function keptGroups(parsed: ParsedRobots): { rules: ParsedRobots; unevaluated: string[] } | null {
  const rules: Record<string, RobotsRules> = Object.create(null);
  const unevaluated: string[] = [];
  const copies = new Map<string, string | null>();
  const copy = (rule: string): string | null => {
    if (!copies.has(rule)) copies.set(rule, bounded(rule, CAPS.robotsRule));
    return copies.get(rule)!;
  };
  const groupCopies = new Map<RobotsRules, RobotsRules | null>();
  /** The group copied, or null when it is over the rule limit (or a rule over its cap). */
  const kept = (group: RobotsRules): RobotsRules | null => {
    if (!groupCopies.has(group)) groupCopies.set(group, copied(group));
    return groupCopies.get(group)!;
  };
  const copied = (group: RobotsRules): RobotsRules | null => {
    if (group.allow.length + group.disallow.length > MAX_ROBOTS_RULES) return null;
    const allow = group.allow.map(copy);
    const disallow = group.disallow.map(copy);
    // No rule is longer than the file, which is within the rule cap; were one longer, the file would
    // be too large to evaluate rather than read without it.
    if (allow.includes(null) || disallow.includes(null)) return null;
    return {
      allow: allow as string[],
      disallow: disallow as string[],
      ...(group.crawlDelay !== undefined && { crawlDelay: group.crawlDelay }),
    };
  };
  for (const agent of [...READ_AGENTS, ...SEARCH_AGENTS]) {
    if (!Object.hasOwn(parsed.rules, agent)) continue;
    const group = kept(parsed.rules[agent]!);
    if (group !== null) rules[agent] = group;
    else if (READ_AGENTS.has(agent)) return null;
    else unevaluated.push(agent);
  }
  return { rules: { sitemaps: [], rules }, unevaluated };
}

/** An HTML document starts with a tag; a robots.txt line never does. */
const looksLikeHtml = (body: string): boolean => /^[\s\uFEFF]*</.test(body);

/**
 * What a reading keeps of the fetch that read it: what a row shows as evidence, each string bounded.
 * Of the headers, the evidence headers; of the redirects, the last one's request URL, which a row's
 * Host header names; of the body, an excerpt.
 *
 * The request URL is `${origin}/robots.txt`, and an origin is shorter than the URL it came from
 * (within CAPS.url), so the request and redirect URLs are within CAPS.robotsUrl.
 */
function evidenceOf(f: FetchOutcome): FetchOutcome {
  const headers: IncomingHttpHeaders = {};
  for (const name of EVIDENCE_HEADERS) {
    const v = f.headers[name];
    if (v !== undefined) {
      headers[name] = bounded(Array.isArray(v) ? v.join(', ') : String(v), CAPS.headerValue);
    }
  }
  const last = f.hops.at(-1);
  return {
    url: bounded(f.url, CAPS.robotsUrl)!,
    identity: f.identity,
    startedAt: f.startedAt,
    ms: f.ms,
    status: f.status,
    finalUrl: f.finalUrl === null ? null : bounded(f.finalUrl, CAPS.robotsUrl),
    headers,
    hops: last
      ? [{ from: bounded(last.from, CAPS.robotsUrl)!, status: last.status, location: '' }]
      : [],
    redirectStop: f.redirectStop,
    body: bounded(f.body, CAPS.robotsExcerpt),
    bodyCut: f.bodyCut,
    bytes: f.bytes,
    maxBytes: f.maxBytes,
    error: f.error,
  };
}

export function readRobots(received: FetchOutcome): RobotsReading {
  const fetch = evidenceOf(received);
  switch (received.error) {
    case null:
      break;
    case 'ssrf_refused':
      return { state: 'refused', fetch };
    case 'timeout':
      return { state: 'unreachable', why: 'timeout', fetch };
    case 'too_large':
      // Cut off at the size cap, or below it by what the batch's byte budget had left.
      return received.maxBytes >= MAX_ROBOTS_BYTES
        ? { state: 'too_large', why: 'bytes', fetch }
        : { state: 'unreachable', why: 'byte_budget', fetch };
    default:
      return { state: 'unreachable', why: 'network', fetch };
  }
  const status = received.status!;
  if (challengeOf(received)) return { state: 'unreachable', why: 'challenged', fetch };
  if (status >= 500) return { state: 'unreachable', why: 'server_error', fetch };
  if (status >= 400) return { state: 'none', why: 'client_error', fetch };
  if (status >= 200 && status < 300) {
    if (looksLikeHtml(received.body)) return { state: 'none', why: 'html_soft_404', fetch };
    if (robotsBytes(received.body) > MAX_ROBOTS_BYTES)
      return { state: 'too_large', why: 'bytes', fetch };
    // The engine splits CR, LF and CRLF line endings and stores a group once, however many agents
    // name it. The file is within its parse limit (checked above), so it reads all of it.
    const kept = keptGroups(parseRobotsTxt(received.body));
    return kept
      ? { state: 'rules', rules: kept.rules, unevaluated: kept.unevaluated, fetch }
      : { state: 'too_large', why: 'rules', fetch };
  }
  return { state: 'unreachable', why: 'redirect_status', fetch };
}

const ours = OUR_ROBOTS_TOKENS.map((t) => t.toLowerCase());

/** Our groups that the file declares; with none, `*` binds our requests. */
function ourGroups(rules: ParsedRobots): string[] {
  const present = ours.filter((t) => rules.rules[t] !== undefined);
  return present.length ? present : ['*'];
}

/**
 * One path matched against a file's groups, each group at most once: agents that share a group (the
 * search engines and our crawler all falling back to `*`, say) share its match. Matching is linear
 * in a group's rules, and a group can hold MAX_ROBOTS_RULES.
 */
export class PathMatch {
  private readonly seen = new Map<RobotsRules, boolean>();

  constructor(
    private readonly rules: ParsedRobots,
    private readonly pathAndQuery: string,
  ) {}

  /** `isAllowedByRobots(rules, agent, path)`: the agent's own group, else `*`. */
  allows(agent: string): boolean {
    const own = agent.toLowerCase();
    const group = Object.hasOwn(this.rules.rules, own)
      ? this.rules.rules[own]
      : this.rules.rules['*'];
    if (group === undefined) return true;
    let allowed = this.seen.get(group);
    if (allowed === undefined) {
      allowed = isAllowedByRobots(this.rules, agent, this.pathAndQuery);
      this.seen.set(group, allowed);
    }
    return allowed;
  }
}

/** Our own requests are allowed on a path only if every one of our groups that exists allows it. */
export function oursAllow(
  rules: ParsedRobots | null,
  pathAndQuery: string,
  match: PathMatch | null = null,
): boolean {
  if (!rules) return true;
  const m = match ?? new PathMatch(rules, pathAndQuery);
  return ourGroups(rules).every((g) => m.allows(g));
}

/** A crawler's own group, or `*` when it has none. */
export function tokenAllows(
  rules: ParsedRobots | null,
  token: string,
  pathAndQuery: string,
): boolean {
  return rules ? isAllowedByRobots(rules, token, pathAndQuery) : true;
}

/**
 * The largest Crawl-delay, in seconds, that applies to any request the batch will make: our groups
 * (or `*`), and each of `tokens` by its own group or `*`. Null when none is declared.
 */
export function crawlDelaySeconds(
  rules: ParsedRobots | null,
  tokens: readonly string[],
): number | null {
  if (!rules) return null;
  const delays = [
    ...ourGroups(rules).map((g) => rules.rules[g]?.crawlDelay),
    ...tokens.map((t) => getCrawlDelay(rules, t)),
  ].filter((d): d is number => d !== undefined);
  return delays.length ? Math.max(...delays) : null;
}

/**
 * What robots.txt says to each search engine about a URL, from the reading the crawl obeyed: by its
 * own group, or `*` where it has none. No robots.txt allows everything. A reading that did not
 * evaluate rules (unreachable, too large, refused, or none read) measures nothing, and neither does
 * a group left out as too large (`unevaluated`). `match`, when given, is the path's match the crawl
 * already made for our own requests, so a group it matched is not matched again.
 */
export function searchVerdicts(
  reading: RobotsReading | null,
  pathAndQuery: string,
  match: PathMatch | null = null,
): SearchRobots {
  const each = (verdict: (robotsToken: string) => SearchRobots[number]['verdict']): SearchRobots =>
    SEARCH_ENGINES.map(({ token, robotsToken }) => ({ ua: token, verdict: verdict(robotsToken) }));
  if (reading?.state === 'none') return each(() => 'allowed');
  if (reading?.state !== 'rules') return each(() => 'not_measured');
  const m = match ?? new PathMatch(reading.rules, pathAndQuery);
  return each((robotsToken) => {
    if (reading.unevaluated.includes(robotsToken.toLowerCase())) return 'not_measured';
    return m.allows(robotsToken) ? 'allowed' : 'disallowed_by_robots';
  });
}
