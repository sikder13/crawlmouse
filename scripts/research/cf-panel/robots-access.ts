import { createHash } from 'node:crypto';
import { parseRobotsTxt, isAllowedByRobots, type ParsedRobots, type RobotsRules } from '@crawlmouse/engine';
import type { BotAccess, BotAccessResult } from './types.js';

/**
 * USER-AGENT GROUP SELECTION, per RFC 9309 §2.2.1 and Google's reference parser: a group's
 * user-agent value matches a crawler when it is a case-insensitive PREFIX of the crawler's product
 * token, and the LONGEST matching group wins. `*` is the fallback, used only when no group matches.
 *
 * This is deliberately NOT the engine's `isAllowedByRobots` group selection, which looks the token up
 * as an exact key and falls straight through to `*`. Measured against the engine at the time of
 * writing: a file with `User-agent: Applebot / Disallow: /` reports `Applebot-Extended` as ALLOWED
 * under exact-key lookup and DISALLOWED under the rule below. A study of who is blocked cannot use
 * the looser rule, so group selection is done here and only the PATH matching (wildcards, `$`,
 * longest-rule-wins, allow-beats-disallow) is delegated to the engine — via a one-group shim, so
 * there is no second copy of that matcher.
 */
export function selectGroup(
  robots: ParsedRobots,
  token: string,
): { key: string | null; rules: RobotsRules | null } {
  const t = token.toLowerCase();
  let bestKey: string | null = null;
  for (const key of Object.keys(robots.rules)) {
    if (key === '*') continue;
    if (!t.startsWith(key)) continue;
    if (bestKey === null || key.length > bestKey.length) bestKey = key;
  }
  if (bestKey !== null) return { key: bestKey, rules: robots.rules[bestKey]! };
  const star = robots.rules['*'];
  return star ? { key: '*', rules: star } : { key: null, rules: null };
}

/**
 * Effective access for one token.
 *
 * `unmentioned` means NOTHING in the file applies — no matching group and no `*` group. It is not
 * used for "no group names this bot but `*` blocks everything": that site HAS blocked the bot, and
 * labelling it `unmentioned` would hide exactly the change this study exists to measure. Whether a
 * bot was named at all is carried separately, in `mentioned`.
 */
export function accessForToken(robots: ParsedRobots, token: string): BotAccessResult {
  const { key, rules } = selectGroup(robots, token);
  if (!rules || key === null) {
    return { token, status: 'unmentioned', mentioned: false, matchedGroup: null };
  }

  // Delegate path matching to the engine by presenting the selected group under the token's own key,
  // which is what the engine's exact-key lookup will find.
  const shim: ParsedRobots = { sitemaps: [], rules: { [token.toLowerCase()]: rules } };
  const rootAllowed = isAllowedByRobots(shim, token, '/');

  let status: BotAccess;
  if (!rootAllowed) status = 'disallowed_root';
  else if (rules.disallow.length > 0) status = 'partially_disallowed';
  else status = 'allowed';

  return { token, status, mentioned: key !== '*', matchedGroup: key };
}

export function accessMatrix(robotsBody: string, tokens: readonly string[]): BotAccessResult[] {
  const robots = parseRobotsTxt(robotsBody);
  return tokens.map((t) => accessForToken(robots, t));
}

/**
 * Content Signals lines, verbatim and in file order. The convention puts the signal in a robots.txt
 * COMMENT (`# Content-Signal: search=yes, ai-train=no`), so a parser that drops comments — the
 * engine's does, correctly, for crawl decisions — cannot see it. The raw text is scanned instead.
 * The contentsignals.org boilerplate block is matched too, by its URL, since sites paste it whole.
 */
export function extractContentSignals(robotsBody: string): string[] {
  const out: string[] = [];
  for (const raw of robotsBody.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const bare = line.replace(/^\s*#+\s*/, '').trim();
    if (/^content-signal\b/i.test(bare) || /contentsignals\.org/i.test(line)) out.push(line);
  }
  return out;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
