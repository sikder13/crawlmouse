/**
 * Row 23, the daily sentinel's pure half: which hour of the day a site is watched, which of its
 * pages are looked at, and what counts as a move. The steps that look and start a full check are
 * `crawlmouse.sentinel.tick`'s (inngest/sentinel.ts), with their work in sentinel-work.ts.
 *
 * The baseline is the site's latest full check: its access tests, one page per template. A look
 * fetches the same pages as each crawler again, through the worker's access batch, and stores
 * nothing. A move is an identity (a crawler, the control or the canary) whose verdict on a template changed class, or a template whose text
 * fell under a fifth of what the full check read. A move seen twice, minutes apart, starts a full
 * check, whose diff and the existing alert rules raise the alert.
 */
import { createHash } from 'node:crypto';
import type { IdentityRole, Verdict } from '@crawlmouse/types/v2';

/** Templates looked at per site, at most. */
export const SENTINEL_MAX_TEMPLATES = 8;

/** The hour of the day (UTC, 0 to 23) a site is watched: from its id, so the same every day. */
export function sentinelHour(siteId: string): number {
  return createHash('sha256').update(`sentinel:${siteId}`).digest().readUInt32BE(0) % 24;
}

/** A full check's access test as `pickPages` reads it. */
export interface TestedPage {
  template_key: string;
  page_url: string;
  ua: string | null;
}

/**
 * One page per template, the one the full check tested first by address, in template order, at most
 * SENTINEL_MAX_TEMPLATES of them. The home template `/` sorts first, so it is always among them.
 */
export function pickPages(tests: readonly TestedPage[]): { template_key: string; url: string }[] {
  const first = new Map<string, string>();
  for (const t of tests) {
    const had = first.get(t.template_key);
    if (had === undefined || t.page_url < had) first.set(t.template_key, t.page_url);
  }
  return [...first.keys()]
    .sort()
    .slice(0, SENTINEL_MAX_TEMPLATES)
    .map((template_key) => ({ template_key, url: first.get(template_key)! }));
}

export type VerdictClass = 'allowed' | 'blocked' | 'challenged' | 'refused' | 'unknown';

/** The verdicts grouped as the screens name them (lib/v2/sentences.ts, isAllowed and the rest). */
export function verdictClass(v: Verdict): VerdictClass {
  switch (v) {
    case 'allowed':
    case 'allowed_thin':
      return 'allowed';
    case 'disallowed_by_robots':
    case 'blocked_by_ua_rule':
      return 'blocked';
    case 'challenged_ua':
    case 'refused_unverified':
      return 'challenged';
    case 'rate_limited':
    case 'payment_required':
    case 'edge_blocks_automation':
    case 'redirected_away':
      return 'refused';
    case 'not_measured':
      return 'unknown';
  }
}

/**
 * One identity's answer on one template, from a full check's access test or from a look: a crawler
 * (`ua` set), or the control or canary (`ua` null), told apart by `identity_role`.
 */
export interface Look {
  identity_role: IdentityRole;
  ua: string | null;
  template_key: string;
  verdict: Verdict;
  word_count: number | null;
}

type Who = { identity_role: IdentityRole; ua: string | null; template_key: string };

export type Movement =
  | (Who & { from: Verdict; to: Verdict })
  | (Who & { from_words: number; to_words: number });

/** A template's text counts as gone when a look reads under this share of the baseline's words. */
const WORDS_GONE = 1 / 5;

const who = (l: Who): Who => ({
  identity_role: l.identity_role,
  ua: l.ua,
  template_key: l.template_key,
});
const keyOf = (l: Who) => `${l.identity_role}\u0000${l.ua ?? ''}\u0000${l.template_key}`;

/**
 * What moved between `baseline` and `now`, for each identity and template both hold. An identity and
 * template the baseline holds more than once (several pages of a template were tested) is compared
 * with all of them: a verdict moved when its class is none of the baseline's, and text went when the
 * look read under a fifth of the fewest words the baseline read. A side that was not measured, or a
 * pair only one side holds, is not compared.
 */
export function movements(baseline: readonly Look[], now: readonly Look[]): Movement[] {
  const before = new Map<
    string,
    { classes: Set<VerdictClass>; from: Verdict; words: number | null }
  >();
  for (const b of baseline) {
    const c = verdictClass(b.verdict);
    if (c === 'unknown') continue;
    const had = before.get(keyOf(b));
    if (!had) {
      before.set(keyOf(b), { classes: new Set([c]), from: b.verdict, words: b.word_count });
      continue;
    }
    had.classes.add(c);
    had.words =
      had.words === null || b.word_count === null ? null : Math.min(had.words, b.word_count);
  }
  const out: Movement[] = [];
  for (const l of now) {
    const b = before.get(keyOf(l));
    const to = verdictClass(l.verdict);
    if (!b || to === 'unknown') continue;
    if (!b.classes.has(to)) {
      out.push({ ...who(l), from: b.from, to: l.verdict });
      continue;
    }
    if (
      b.words !== null &&
      l.word_count !== null &&
      b.words > 0 &&
      l.word_count < b.words * WORDS_GONE
    ) {
      out.push({
        ...who(l),
        from_words: b.words,
        to_words: l.word_count,
      });
    }
  }
  return out;
}
