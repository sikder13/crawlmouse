/**
 * One verdict per crawler for the site, from its cells.
 *
 * 1. No measured cell (the contract's UNMEASURED_VERDICTS): `edge_blocks_automation` when any cell
 *    carries it, otherwise `not_measured`. Never an allow.
 * 2. Otherwise the verdict most of the measured cells carry, a tie going to the one earlier in
 *    TIE_ORDER: the weaker claim.
 * 3. A block (`disallowed_by_robots`, `blocked_by_ua_rule`) is never the site verdict when any page
 *    served the crawler: then the verdict is the served cells' own (rule 2 over them). How many pages
 *    each verdict covers is kept in `counts`, so the extent is never lost.
 *
 * The cells that carry the site verdict decide the rest: the cause when they all name the same one,
 * the evidence class, and the status most of them answered with (the lower on a tie; none when the
 * verdict rests on robots.txt alone).
 */
import {
  UNMEASURED_VERDICTS,
  type AccessCause,
  type Confidence,
  type CrawlerRegistryEntry,
  type Verdict,
} from '@crawlmouse/types/v2';
import { byText, sorted } from '../detectors/scope.js';
import type { Cell, CrawlerAccess } from './types.js';

export const SERVED: readonly Verdict[] = ['allowed', 'allowed_thin'];
export const BLOCKED: readonly Verdict[] = ['disallowed_by_robots', 'blocked_by_ua_rule'];

/** Every measured verdict, the weaker claim first: a tie goes to the earlier. */
export const TIE_ORDER: readonly Verdict[] = [
  'allowed_thin',
  'allowed',
  'rate_limited',
  'redirected_away',
  'payment_required',
  'refused_unverified',
  'challenged_ua',
  'disallowed_by_robots',
  'blocked_by_ua_rule',
];

/** Verdicts that say the real crawler may get something else: never stated with full confidence. */
export const UNCERTAIN: readonly Verdict[] = ['challenged_ua', 'refused_unverified'];

export const isMeasured = (v: Verdict): boolean => !UNMEASURED_VERDICTS.includes(v);

function plurality(verdicts: readonly Verdict[]): Verdict {
  const count = new Map<Verdict, number>();
  for (const v of verdicts) count.set(v, (count.get(v) ?? 0) + 1);
  const most = Math.max(...count.values());
  return TIE_ORDER.find((v) => count.get(v) === most)!;
}

export function siteVerdict(cells: readonly Cell[]): Verdict {
  const measured = cells.filter((c) => isMeasured(c.verdict)).map((c) => c.verdict);
  if (measured.length === 0)
    return cells.some((c) => c.verdict === 'edge_blocks_automation')
      ? 'edge_blocks_automation'
      : 'not_measured';
  const top = plurality(measured);
  const served = measured.filter((v) => SERVED.includes(v));
  return BLOCKED.includes(top) && served.length > 0 ? plurality(served) : top;
}

function confidenceOf(verdict: Verdict, cells: readonly Cell[]): Confidence {
  if (!isMeasured(verdict)) return 'inconclusive';
  if (UNCERTAIN.includes(verdict)) return 'likely';
  const measured = cells.filter((c) => isMeasured(c.verdict));
  return measured.every((c) => c.verdict === verdict) ? 'confirmed' : 'likely';
}

function causeOf(deciding: readonly Cell[]): AccessCause | null {
  const first = deciding[0]?.cause ?? null;
  return deciding.every((c) => c.cause === first) ? first : null;
}

function statusOf(deciding: readonly Cell[], declared: boolean): number | null {
  if (declared) return null;
  const count = new Map<number, number>();
  for (const c of deciding)
    if (c.status !== null) count.set(c.status, (count.get(c.status) ?? 0) + 1);
  if (count.size === 0) return null;
  const most = Math.max(...count.values());
  return Math.min(...[...count].filter(([, n]) => n === most).map(([s]) => s));
}

/** Declared when every deciding cell rests on robots.txt; a crawler with no cell is as its kind is read. */
const declaredOf = (deciding: readonly Cell[], entry: CrawlerRegistryEntry): boolean =>
  deciding.length > 0 ? deciding.every((c) => c.evidence_class === 'declared') : !entry.testable;

function byTemplate(cells: readonly Cell[]): CrawlerAccess['by_template'] {
  const groups = new Map<string, Cell[]>();
  for (const c of cells)
    if (c.template_key !== null)
      (groups.get(c.template_key) ?? groups.set(c.template_key, []).get(c.template_key)!).push(c);
  return [...groups.keys()].sort(byText).map((template_key) => {
    const group = groups.get(template_key)!;
    const verdict = siteVerdict(group);
    const deciding = group.filter((c) => c.verdict === verdict);
    return {
      template_key,
      verdict,
      status: statusOf(
        deciding,
        deciding.every((c) => c.evidence_class === 'declared'),
      ),
    };
  });
}

export function crawlerAccess(entry: CrawlerRegistryEntry, cells: readonly Cell[]): CrawlerAccess {
  const verdict = siteVerdict(cells);
  const deciding = cells.filter((c) => c.verdict === verdict);
  const declared = declaredOf(deciding, entry);
  const counts: CrawlerAccess['counts'] = {};
  for (const c of cells) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
  return {
    ua: entry.token,
    group: entry.group,
    scored: entry.scored,
    verdict,
    evidence_class: declared ? 'declared' : 'simulated',
    status: statusOf(deciding, declared),
    pages_measured: cells.filter((c) => isMeasured(c.verdict)).length,
    cause: causeOf(deciding),
    confidence: confidenceOf(verdict, cells),
    by_template: byTemplate(cells),
    counts,
    supporting: {
      access_test_ids: sorted(deciding.flatMap((c) => (c.id === null ? [] : [c.id]))),
      pages: sorted(deciding.map((c) => c.page_url)),
    },
    intent: verdict === 'disallowed_by_robots' ? 'respected' : null,
  };
}
