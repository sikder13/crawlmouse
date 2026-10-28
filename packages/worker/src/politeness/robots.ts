import {
  getCrawlDelay,
  isAllowedByRobots,
  parseRobotsTxt,
  type ParsedRobots,
  type RobotsRules,
} from '@crawlmouse/engine/worker';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { CANARY, CRAWLERS, OUR_ROBOTS_TOKENS } from '../identities.js';
import { detached } from '../rows/detached.js';
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
 * A reading holds copies of the groups the worker reads and the first ROBOTS_EXCERPT_CHARS of the
 * file, as evidence. It holds no other part of the file.
 */

/**
 * RFC 9309 has crawlers parse at least 500 KiB; a larger file is not evaluated. Counted as the
 * engine's parse limit counts: UTF-8 bytes after a leading byte order mark.
 */
export const MAX_ROBOTS_BYTES = 500 * 1024;
/** A UTF-8 byte order mark, which the size does not count. */
const BOM_BYTES = 3;
/** What the request for robots.txt may read: the size limit and a byte order mark. */
export const MAX_ROBOTS_REQUEST_BYTES = MAX_ROBOTS_BYTES + BOM_BYTES;

/** A file's size as MAX_ROBOTS_BYTES counts it. */
const robotsBytes = (body: string): number =>
  Buffer.byteLength(body) - (body.charCodeAt(0) === 0xfeff ? BOM_BYTES : 0);
/** The most rules (Allow and Disallow lines) one group the worker reads may hold. */
export const MAX_ROBOTS_RULES = 5000;
/** How much of the file a reading keeps, as evidence. */
export const ROBOTS_EXCERPT_CHARS = 4096;

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
  | { state: 'rules'; rules: ParsedRobots; fetch: FetchOutcome }
  | { state: 'none'; why: 'client_error' | 'html_soft_404'; fetch: FetchOutcome }
  | { state: 'unreachable'; why: UnreachableReason; fetch: FetchOutcome }
  | { state: 'too_large'; why: TooLargeReason; fetch: FetchOutcome }
  | { state: 'refused'; fetch: FetchOutcome };

/**
 * The groups the worker ever looks up: ours, `*`, and each identity it sends. A group for any other
 * agent never decides a request of ours, so before the engine parses the file, every other agent is
 * renamed to IGNORED_AGENT, and an agent repeated within one group is dropped.
 *
 * The engine stores each rule line once per agent in its group, so a group of N agents and M rules
 * costs N x M entries: a 500 KiB file of a few thousand agent lines would exhaust the worker's memory.
 * After this pass a group holds at most READ_AGENTS.size + 1 agents.
 */
const READ_AGENTS = new Set(
  [...OUR_ROBOTS_TOKENS, '*', ...CRAWLERS.map((c) => c.robotsToken!), CANARY.robotsToken!].map(
    (t) => t.toLowerCase(),
  ),
);
const IGNORED_AGENT = '-crawlmouse-ignored-agent-';

/**
 * Rewrites the lines the way the engine reads them (comments stripped, `Directive: value`): a run of
 * User-agent lines is one group until a rule line ends it, and blank, comment, Sitemap and unknown
 * lines leave a group open.
 */
function narrowGroups(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inRules = false;
  let group = new Set<string>();
  for (const raw of lines) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*$/, '').trim());
    const directive = m?.[1]!.toLowerCase();
    if (directive === 'user-agent') {
      if (inRules) {
        group = new Set();
        inRules = false;
      }
      const value = m![2]!.trim().toLowerCase();
      const agent = READ_AGENTS.has(value) ? value : value ? IGNORED_AGENT : '';
      if (agent && group.has(agent)) continue;
      group.add(agent);
      out.push(`User-agent: ${agent}`);
      continue;
    }
    if (directive === 'allow' || directive === 'disallow' || directive === 'crawl-delay')
      inRules = true;
    out.push(raw);
  }
  return out;
}

/**
 * Splits CR, CRLF and LF line endings (the engine splits on `\n` only), and narrows each group to the
 * agents the worker reads (see READ_AGENTS), before the engine parses the file.
 */
export function parseRobotsBody(text: string): ParsedRobots {
  return parseRobotsTxt(narrowGroups(text.split(/\r\n?|\n/)).join('\n'));
}

/**
 * The groups the worker reads, copied out of the parsed file so that nothing holds the file; null when
 * one of them has more than MAX_ROBOTS_RULES rules. A rule that several groups share is copied once.
 */
function keptGroups(parsed: ParsedRobots): ParsedRobots | null {
  const rules: Record<string, RobotsRules> = Object.create(null);
  const copies = new Map<string, string>();
  const copy = (rule: string): string => {
    let c = copies.get(rule);
    if (c === undefined) copies.set(rule, (c = detached(rule)));
    return c;
  };
  for (const agent of READ_AGENTS) {
    if (!Object.hasOwn(parsed.rules, agent)) continue;
    const group = parsed.rules[agent]!;
    if (group.allow.length + group.disallow.length > MAX_ROBOTS_RULES) return null;
    rules[agent] = {
      allow: group.allow.map(copy),
      disallow: group.disallow.map(copy),
      ...(group.crawlDelay !== undefined && { crawlDelay: group.crawlDelay }),
    };
  }
  return { sitemaps: [], rules };
}

/** An HTML document starts with a tag; a robots.txt line never does. */
const looksLikeHtml = (body: string): boolean => /^[\s\uFEFF]*</.test(body);

export function readRobots(received: FetchOutcome): RobotsReading {
  const fetch = { ...received, body: detached(received.body.slice(0, ROBOTS_EXCERPT_CHARS)) };
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
    const rules = keptGroups(parseRobotsBody(received.body));
    return rules ? { state: 'rules', rules, fetch } : { state: 'too_large', why: 'rules', fetch };
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
