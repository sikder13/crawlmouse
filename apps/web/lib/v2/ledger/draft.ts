/**
 * The research ledger's draft (CC-41 D4): what one ended check's ledger rows hold, computed in the
 * check's build step from what only that step has (the crawl batches' unanswered pages, robots.txt as
 * the build read it) and stored in `public.check_ledger_drafts` until the writer records it.
 *
 * A draft holds the ledger's own fields and nothing else (docs/specs/v2/06b-data-foundations.md, the
 * field rules): no account, user, email, check, URL, path or host. The site key and the month are
 * the writer's, made from the check's row when it writes. `LedgerDraftSchema` is strict, so a field
 * this module did not put there fails the parse, and the table's CHECK refuses any other top-level
 * key (migration 20261120000001).
 */
import { z } from 'zod';
import {
  CmsNameSchema,
  PacketFrameworkSchema,
  SignalKindSchema,
  VerdictSchema,
  AccessCauseSchema,
  type Check,
  type CrawlBatchResult,
  type CrawlerRegistryEntry,
} from '@crawlmouse/types/v2';
import { jsTextState, parseRobotsTxt, type RobotsRules } from '@crawlmouse/engine/v2/pipeline';

export const ROBOTS_RULES = [
  'named_allow_all',
  'named_disallow_all',
  'named_partial',
  'wildcard_allow_all',
  'wildcard_disallow_all',
  'wildcard_partial',
  'no_group',
  'not_read',
] as const;
export type RobotsRule = (typeof ROBOTS_RULES)[number];

/** research.check_runs.edge_vendor's CHECK. */
const EDGE_VENDOR = /^[a-z][a-z0-9-]{0,23}$/;
/** research.crawler_observations.crawler's CHECK. */
const CRAWLER_TOKEN = /^[A-Za-z][A-Za-z0-9-]{0,23}$/;

const ShareSchema = z.number().min(0).max(1);

export const ObservationSchema = z.strictObject({
  crawler: z.string().regex(CRAWLER_TOKEN),
  verdict: VerdictSchema,
  cause: AccessCauseSchema.nullable(),
  robots_rule: z.enum(ROBOTS_RULES),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const LedgerDraftSchema = z.strictObject({
  cms: CmsNameSchema.nullable(),
  frontend_framework: PacketFrameworkSchema.nullable(),
  edge_vendor: z.string().regex(EDGE_VENDOR).nullable(),
  without_js_state: z.enum(['readable', 'partial', 'empty_shell']).nullable(),
  share_2xx: ShareSchema,
  share_3xx: ShareSchema,
  share_4xx: ShareSchema,
  share_5xx: ShareSchema,
  share_unanswered: ShareSchema,
  signals_detected: z.array(SignalKindSchema),
  signals_indeterminate: z.array(SignalKindSchema),
  observations: z.array(ObservationSchema),
});
export type LedgerDraft = z.infer<typeof LedgerDraftSchema>;

function extentOf(group: RobotsRules): 'allow_all' | 'disallow_all' | 'partial' {
  const disallow = group.disallow.filter((r) => r !== '');
  const allow = group.allow.filter((r) => r !== '');
  if (disallow.length === 0) return 'allow_all';
  if (allow.length === 0 && disallow.some((r) => r === '/' || r === '/*')) return 'disallow_all';
  return 'partial';
}

/**
 * The robots.txt group that binds a crawler, as a category: its own group (`named_*`), else the
 * wildcard group (`wildcard_*`), else `no_group`; `not_read` when the build read no whole file
 * (`robotsText` gives null). The group is chosen as the worker and the engine choose it: the
 * crawler's robots token, lowercased, as a key of the parsed file, else `*`. `allow_all` is a group
 * with no non-empty Disallow; `disallow_all` one that disallows `/` (or `/*`) and allows nothing; any
 * other group is `partial`. The file's text is never kept.
 */
export function robotsRule(robotsTxt: string | null, robotsToken: string): RobotsRule {
  if (robotsTxt === null) return 'not_read';
  const { rules } = parseRobotsTxt(robotsTxt);
  const own = robotsToken.toLowerCase();
  if (Object.hasOwn(rules, own)) return `named_${extentOf(rules[own]!)}`;
  if (Object.hasOwn(rules, '*')) return `wildcard_${extentOf(rules['*']!)}`;
  return 'no_group';
}

type StatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'unanswered';
const CLASSES: readonly StatusClass[] = ['2xx', '3xx', '4xx', '5xx', 'unanswered'];

function classOf(status: number | null): StatusClass | null {
  if (status === null) return 'unanswered';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return null;
}

/**
 * Each class's share of the crawl's pages, to two decimals, by largest remainder, so the five add
 * up to exactly 1 when there is any page and are all 0 when there is none (the ledger's CHECK allows a
 * sum of 0, or of 0.98 to 1.02). A page fetched in more than one batch counts once, as its last fetch.
 * A status outside 200–599 is in no class and is left out of the total.
 */
export function statusShares(
  crawl: readonly Pick<CrawlBatchResult, 'pages'>[],
): Record<`share_${StatusClass}`, number> {
  const last = new Map<string, number | null>();
  for (const batch of crawl) for (const p of batch.pages) last.set(p.url, p.status_code);
  const counts = new Map<StatusClass, number>(CLASSES.map((c) => [c, 0]));
  for (const status of last.values()) {
    const c = classOf(status);
    if (c !== null) counts.set(c, counts.get(c)! + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const hundredths = new Map<StatusClass, number>(CLASSES.map((c) => [c, 0]));
  if (total > 0) {
    const exact = CLASSES.map((c) => ({ c, x: (counts.get(c)! * 100) / total }));
    for (const { c, x } of exact) hundredths.set(c, Math.floor(x));
    let left = 100 - [...hundredths.values()].reduce((a, b) => a + b, 0);
    const byRemainder = [...exact].sort(
      (a, b) =>
        b.x - Math.floor(b.x) - (a.x - Math.floor(a.x)) ||
        CLASSES.indexOf(a.c) - CLASSES.indexOf(b.c),
    );
    for (const { c } of byRemainder) {
      if (left === 0) break;
      hundredths.set(c, hundredths.get(c)! + 1);
      left -= 1;
    }
  }
  return Object.fromEntries(CLASSES.map((c) => [`share_${c}`, hundredths.get(c)! / 100])) as Record<
    `share_${StatusClass}`,
    number
  >;
}

const uniqueSorted = <T extends string>(xs: readonly T[]): T[] => [...new Set(xs)].sort();

export interface DraftInput {
  check: Pick<Check, 'crawlers' | 'stack' | 'signals' | 'without_js'>;
  crawl: readonly Pick<CrawlBatchResult, 'pages'>[];
  robotsTxt: string | null;
  registry: readonly Pick<CrawlerRegistryEntry, 'token' | 'robots_token'>[];
}

/**
 * The draft of one check. A crawler whose result names a token the registry does not hold is left
 * out, as is an edge vendor that does not fit the ledger's short-name rule: neither is invented. A
 * token with two results is recorded once, by its first.
 */
export function ledgerDraft({ check, crawl, robotsTxt, registry }: DraftInput): LedgerDraft {
  const tokens = new Map(registry.map((e) => [e.token, e.robots_token]));
  const vendor = check.stack?.edge?.vendor.toLowerCase() ?? null;
  return LedgerDraftSchema.parse({
    cms: check.stack?.backend?.cms ?? null,
    frontend_framework: check.stack?.frontend?.framework ?? null,
    edge_vendor: vendor !== null && EDGE_VENDOR.test(vendor) ? vendor : null,
    without_js_state:
      check.without_js === null ? null : jsTextState(check.without_js.site_text_share, null),
    ...statusShares(crawl),
    signals_detected: uniqueSorted(
      check.signals.filter((s) => s.state === 'detected').map((s) => s.signal),
    ),
    signals_indeterminate: uniqueSorted(
      check.signals.filter((s) => s.state === 'indeterminate').map((s) => s.signal),
    ),
    observations: check.crawlers.flatMap((c, i) => {
      const robotsToken = tokens.get(c.ua);
      if (robotsToken === undefined || !CRAWLER_TOKEN.test(c.ua)) return [];
      // The ledger keys an observation by its crawler: a token's first result is the one recorded.
      if (check.crawlers.findIndex((o) => o.ua === c.ua) !== i) return [];
      return [
        {
          crawler: c.ua,
          verdict: c.verdict,
          cause: c.cause,
          robots_rule: robotsRule(robotsTxt, robotsToken),
        },
      ];
    }),
  });
}
