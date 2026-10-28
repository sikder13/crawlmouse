import {
  getCrawlDelay,
  isAllowedByRobots,
  parseRobotsTxt,
  type ParsedRobots,
} from '@crawlmouse/engine/worker';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { OUR_ROBOTS_TOKENS } from '../identities.js';
import { challengeOf, headerValue } from '../verdict/response.js';

/**
 * robots.txt as the worker reads it.
 *
 * The engine's parser and matcher are reused unchanged. What lives here is what the engine does not
 * decide: how a fetch outcome becomes a reading, which groups bind our own requests, and the delay a
 * site declares for the identities in play.
 *
 * - A 4xx means there is no robots.txt: everything is allowed (RFC 9309 "unavailable").
 * - A 5xx, a timeout or a network error means robots.txt is unreachable: the site is treated as fully
 *   disallowed for the batch, and nothing else is fetched (RFC 9309 "unreachable").
 * - A challenge in place of the file is treated as unreachable too: the rules exist but could not be
 *   read, which is not the same as there being none.
 * - An HTML 200 is a soft 404 (a page, not a rules file): no robots.txt.
 * - A refusal by the SSRF guard is not a robots answer at all; the caller reports it as a refusal.
 */

export const MAX_ROBOTS_BYTES = 512 * 1024;

export type UnreachableReason =
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'challenged'
  | 'redirect_status';

export type RobotsReading =
  | { state: 'rules'; rules: ParsedRobots; fetch: FetchOutcome }
  | { state: 'none'; why: 'client_error' | 'html_soft_404'; fetch: FetchOutcome }
  | { state: 'unreachable'; why: UnreachableReason; fetch: FetchOutcome }
  | { state: 'refused'; fetch: FetchOutcome };

/**
 * User-agent values the engine's parser must not see. It keys groups on a plain object, so a group
 * named `__proto__` writes onto Object.prototype, and one named `constructor` makes it throw. A group
 * with any of these names binds no real crawler, so it is renamed to one that binds nothing either.
 */
const INHERITED_NAMES = new Set(
  Object.getOwnPropertyNames(Object.prototype).map((n) => n.toLowerCase()),
);
const UNMATCHABLE_AGENT = '-crawlmouse-unmatchable-agent-';
const USER_AGENT_LINE = /^(\s*user-agent\s*:\s*)([^#]*?)(\s*(?:#.*)?)$/i;

function renameInheritedAgents(line: string): string {
  const m = USER_AGENT_LINE.exec(line);
  return m && INHERITED_NAMES.has(m[2]!.toLowerCase())
    ? `${m[1]}${UNMATCHABLE_AGENT}${m[3]}`
    : line;
}

/**
 * Caps the text at MAX_ROBOTS_BYTES, splits CR, CRLF and LF line endings (the engine splits on `\n`
 * only), and renames user agents that would reach Object.prototype (see INHERITED_NAMES).
 */
export function parseRobotsBody(text: string): ParsedRobots {
  const capped =
    Buffer.byteLength(text) > MAX_ROBOTS_BYTES
      ? Buffer.from(text).subarray(0, MAX_ROBOTS_BYTES).toString('utf8')
      : text;
  return parseRobotsTxt(
    capped
      .split(/\r\n?|\n/)
      .map(renameInheritedAgents)
      .join('\n'),
  );
}

export function readRobots(fetch: FetchOutcome): RobotsReading {
  switch (fetch.error) {
    case null:
      break;
    case 'ssrf_refused':
      return { state: 'refused', fetch };
    case 'timeout':
      return { state: 'unreachable', why: 'timeout', fetch };
    default:
      return { state: 'unreachable', why: 'network', fetch };
  }
  const status = fetch.status!;
  if (challengeOf(fetch)) return { state: 'unreachable', why: 'challenged', fetch };
  if (status >= 500) return { state: 'unreachable', why: 'server_error', fetch };
  if (status >= 400) return { state: 'none', why: 'client_error', fetch };
  if (status >= 200 && status < 300) {
    if (headerValue(fetch.headers, 'content-type').includes('html')) {
      return { state: 'none', why: 'html_soft_404', fetch };
    }
    return { state: 'rules', rules: parseRobotsBody(fetch.body), fetch };
  }
  return { state: 'unreachable', why: 'redirect_status', fetch };
}

const ours = OUR_ROBOTS_TOKENS.map((t) => t.toLowerCase());

/** Our groups that the file declares; with none, `*` binds our requests. */
function ourGroups(rules: ParsedRobots): string[] {
  const present = ours.filter((t) => rules.rules[t] !== undefined);
  return present.length ? present : ['*'];
}

/** Our own requests are allowed on a path only if every one of our groups that exists allows it. */
export function oursAllow(rules: ParsedRobots | null, pathAndQuery: string): boolean {
  if (!rules) return true;
  return ourGroups(rules).every((g) => isAllowedByRobots(rules, g, pathAndQuery));
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
