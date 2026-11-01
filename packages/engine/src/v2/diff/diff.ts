/**
 * CC-19: one check of a site against the one before it, as fix lifecycle steps and change rows.
 * Pure: no database, queue or network. The same input gives byte-identical output, and listing the
 * fixes, events or outcomes in another order does not change it ('determinism' in diff.test.ts).
 *
 * Each fingerprint's outcome on this check moves its fix through LIFECYCLE (lifecycle.ts). A row is
 * written for an opening or a resolution only between two checks that both measured the subject:
 *
 * - On the first graded check of a site (no previous), a fix it opens writes a row. There is no
 *   check to compare a grade, a crawler or robots.txt with, so those rows are not written.
 * - When the two checks were graded under different `grade_version`s, the only row is one baseline
 *   row; the fixes still move.
 * - When the coverage a fix type depends on changed (the page cap, or the sample: COVERAGE_DEPENDENCE),
 *   a fix of that type is not resolved (`not_detected` is read as `indeterminate`) and writes no row.
 * - An existing fix writes a row only if the previous check measured it (its last measurement is
 *   the previous check, and found it or found it gone); a new fix, only if the previous check ran its
 *   detector. The one exception is a fix that is `unable_to_verify`: the check that set that status
 *   could not measure it by definition, and the mapping table gives its next measurement a row.
 * - A crawler-access fix whose crawler has a row of its own that moved the same way, and tells no
 *   other fix, is told on that row (its `fix_id`) instead of a second one.
 * - An event about a fix dated at or after this check's finish (the owner marked it done since) makes
 *   the check's outcome for that fix count as absent: the measurement is older than the claim.
 * - A new fix's row also needs the previous check not to have reported its fingerprint
 *   indeterminate.
 */
import {
  ChangeSchema,
  FixEventSchema,
  FixSchema,
  instant,
  type Change,
  type Check,
  type Fix,
  type FixEvent,
  type FixStatus,
  type FixType,
} from '@crawlmouse/types/v2';
import {
  baselineRow,
  crawlerRows,
  deployRow,
  fixRow,
  gradeRow,
  robotsRow,
  type RowContext,
} from './changes.js';
import { stableId } from './ids.js';
import { EVENT_OF, LIFECYCLE, ROW_OF, statusOf, type Action, type Outcome } from './lifecycle.js';
import { lineDiff, type LineDiff } from './robots-diff.js';
import {
  COVERAGE_DEPENDENCE,
  FIX_SECTION,
  FIX_SUBJECT,
  type CoverageDependence,
} from './subjects.js';
import type { CheckSide, DiffInput, DiffResult, FixDraft } from './types.js';

const graded = (c: Check) => c.status === 'finished' || c.status === 'partial';
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function diffCheck(input: DiffInput): DiffResult {
  const { previous, current } = input;
  if (!graded(current.check)) return { fixes: [], events: [], changes: [] };
  checkInput(input);

  const at = current.check.finished_at!;
  const ctx: RowContext = {
    site_id: current.check.site_id,
    check_id: current.check.id,
    previous_check_id: previous?.check.id ?? null,
    detected_at: at,
    pages_crawled: current.check.coverage!.pages_crawled,
  };
  const history = eventsByFix(input.fixes, input.events);
  const existing = new Map(input.fixes.map((f) => [f.fingerprint, f]));
  const outcomes = new Map(input.outcomes.map((o) => [o.fingerprint, o]));
  const sameGrading =
    previous !== null && previous.check.grade_version === current.check.grade_version;
  const coverageMoved = changedCoverage(previous, current);
  let nextNumber = input.fixes.reduce((n, f) => Math.max(n, f.number), 0) + 1;
  const finished = instant(at);

  const fixes: Fix[] = [];
  const events: FixEvent[] = [];
  const fixRows: { row: Change; fix: Fix }[] = [];
  for (const fingerprint of [...new Set([...existing.keys(), ...outcomes.keys()])].sort(byText)) {
    const before = existing.get(fingerprint) ?? null;
    const outcome = outcomes.get(fingerprint);
    const type = before?.type ?? (outcome?.state === 'detected' ? outcome.fix.type : null);
    let seen: Outcome = outcome?.state ?? 'absent';
    // An event about the fix dated at or after this check's finish (the owner marked it done since)
    // is not older than the check's measurement, so the measurement does not act on the fix. At the
    // same instant, acting would leave the history's order to the events' ids.
    const latest = before ? history.get(before.id)!.at(-1) : undefined;
    if (latest && instant(latest.at) >= finished) seen = 'absent';
    if (seen === 'not_detected' && type && coverageMoved.has(COVERAGE_DEPENDENCE[type])) {
      seen = 'indeterminate';
    }
    const prior = before?.status ?? 'none';
    const action = LIFECYCLE[seen][prior];
    const draft = outcome?.state === 'detected' ? outcome.fix : null;
    const after = apply(action, before, draft, { fingerprint, at, ctx, number: nextNumber });
    if (!after) continue;
    if (action === 'insert') nextNumber++;
    if (after !== before) fixes.push(after);
    const kind = EVENT_OF[action];
    if (kind) events.push(event(after, kind, current.check.id, at));
    const rowKind = ROW_OF[action];
    if (!rowKind || (!sameGrading && previous !== null)) continue;
    if (coverageMoved.has(COVERAGE_DEPENDENCE[after.type])) continue;
    const measuredBefore =
      previous === null
        ? action === 'insert'
        : before === null
          ? previous.detectors.includes(after.type) && !previous.indeterminate.includes(fingerprint)
          : (before.last_measured_check_id === previous.check.id &&
              before.last_state !== 'indeterminate') ||
            // The table's own exception: unable_to_verify waits for the next check that can measure
            // the fix, and that check's answer is the row, though the check before could not measure.
            prior === 'unable_to_verify';
    if (!measuredBefore) continue;
    fixRows.push({
      row: fixRow(ctx, after, rowKind, prior, history.get(after.id) ?? []),
      fix: after,
    });
  }

  const byNumber = (a: Fix, b: Fix) => a.number - b.number;
  fixes.splice(0, fixes.length, ...reranked(input.fixes, fixes).sort(byNumber));
  const order = new Map(fixes.map((f, k) => [f.id, k]));
  events.sort((a, b) => order.get(a.fix_id)! - order.get(b.fix_id)!);
  fixRows.sort((a, b) => byNumber(a.fix, b.fix));
  const changes = changeRows(ctx, previous, current, sameGrading, fixRows);
  // The contract's own schemas have the last word: a record they reject is never returned.
  for (const f of fixes) FixSchema.parse(f);
  for (const e of events) FixEventSchema.parse(e);
  for (const c of changes) ChangeSchema.parse(c);
  return { fixes, events, changes };
}

/**
 * The fixes this check changed, with the site's live fixes (all but `verified_resolved`) ranked 1
 * to n: by the rank they now hold (the detector's for a fix found on this check, the stored one for
 * the rest), then by number. The contract's tests hold live ranks distinct, and a detector ranks
 * only what it found, so the ranks are settled here. A fix whose rank alone moved is returned too.
 */
function reranked(before: readonly Fix[], changed: readonly Fix[]): Fix[] {
  const now = new Map(before.map((f) => [f.id, f]));
  for (const f of changed) now.set(f.id, f);
  const live = [...now.values()]
    .filter((f) => f.status !== 'verified_resolved')
    .sort((a, b) => a.rank! - b.rank! || a.number - b.number);
  const out = new Map(changed.map((f) => [f.id, f]));
  live.forEach((f, k) => {
    if (f.rank !== k + 1) out.set(f.id, { ...f, rank: k + 1 });
  });
  return [...out.values()];
}

/** The rows of a check, in order: crawlers, robots.txt, grade, deploy, then fixes by number. */
function changeRows(
  ctx: RowContext,
  previous: CheckSide | null,
  current: CheckSide,
  sameGrading: boolean,
  fixRows: { row: Change; fix: Fix }[],
): Change[] {
  if (previous === null) return fixRows.map((r) => r.row);
  if (!sameGrading) {
    return [baselineRow(ctx, previous.check.grade_version, current.check.grade_version)];
  }
  const robots = robotsChange(previous, current);
  const crawlers = crawlerRows(ctx, previous.check, current.check, robots);
  // A crawler-access fix is told on its crawler's row when that row moved the same way (both
  // opened, or both resolved) and tells no other fix yet; otherwise the fix keeps a row of its own.
  const told = new Set<string>();
  for (const { row, fix } of fixRows) {
    if (FIX_SUBJECT[fix.type] !== 'crawler_access') continue;
    const k = crawlers.findIndex(
      (c) =>
        c.ua !== null && fix.crawler_uas.includes(c.ua) && c.kind === row.kind && c.fix_id === null,
    );
    if (k < 0) continue;
    told.add(row.id);
    crawlers[k] = withFix(crawlers[k]!, fix.id);
  }
  const robotsQuoted = crawlers.some((c) => c.cause?.diff);
  return [
    ...crawlers,
    ...(robots && !robotsQuoted ? [robotsRow(ctx, robots)] : []),
    ...[
      gradeRow(ctx, previous.check, current.check),
      deployRow(ctx, previous.check, current.check),
    ].filter((r): r is Change => r !== null),
    ...fixRows.filter((r) => !told.has(r.row.id)).map((r) => r.row),
  ];
}

/** A crawler row that now carries the fix told on it; its id follows, as it names the fix. */
function withFix(row: Change, fixId: string): Change {
  return { ...row, id: stableId('change', row.id, fixId), fix_id: fixId };
}

/** The robots.txt diff, when both checks read the file and it changed. */
function robotsChange(previous: CheckSide, current: CheckSide): LineDiff | null {
  if (previous.robots_txt === null || current.robots_txt === null) return null;
  const diff = lineDiff(previous.robots_txt, current.robots_txt);
  return diff.removed.length + diff.added.length > 0 ? diff : null;
}

/** Which kinds of coverage differ between the two checks. */
function changedCoverage(previous: CheckSide | null, current: CheckSide): Set<CoverageDependence> {
  const moved = new Set<CoverageDependence>();
  if (previous === null) return moved;
  const was = previous.check.coverage!;
  const now = current.check.coverage!;
  if (previous.page_cap !== current.page_cap) moved.add('page_cap');
  if (
    was.sample_strategy.method !== now.sample_strategy.method ||
    was.sample_strategy.max_pages !== now.sample_strategy.max_pages ||
    was.pages_sampled !== now.pages_sampled
  ) {
    moved.add('sample');
  }
  return moved;
}

interface Place {
  fingerprint: string;
  at: string;
  ctx: RowContext;
  /** The number a new fix takes. */
  number: number;
}

/** The fix after `action`: the same object when it is left as it was (null when there is none). */
function apply(action: Action, fix: Fix | null, draft: FixDraft | null, place: Place): Fix | null {
  const checkId = place.ctx.check_id;
  switch (action) {
    case 'untouched':
      return fix;
    case 'insert':
      return inserted(draft!, place);
    case 'refresh':
      return measured(fix!, draft!, checkId);
    case 'remeasure':
      return { ...fix!, last_measured_check_id: checkId };
    case 'reopen':
      return { ...measured(fix!, draft!, checkId), status: 'reopened' };
    case 'verify':
      return {
        ...fix!,
        status: 'verified_resolved',
        last_state: 'not_detected',
        last_measured_check_id: checkId,
        rank: null,
      };
    case 'unable_to_verify':
      return {
        ...fix!,
        status: 'unable_to_verify',
        last_state: 'indeterminate',
        last_measured_check_id: checkId,
      };
  }
}

/** A fix found again: what the detector measured replaces what it measured last time. */
function measured(fix: Fix, draft: FixDraft, checkId: string): Fix {
  return {
    ...fix,
    last_state: 'detected',
    last_measured_check_id: checkId,
    confidence: draft.confidence,
    affected_pages: draft.affected_pages,
    rank: draft.rank,
    effect: draft.effect,
    before_after: draft.before_after,
    packet: draft.packet,
  };
}

function inserted(draft: FixDraft, place: Place): Fix {
  const site = place.ctx.site_id;
  return {
    id: stableId('fix', site, place.fingerprint),
    site_id: site,
    fingerprint: place.fingerprint,
    number: place.number,
    type: draft.type,
    section: draft.section,
    title: draft.title,
    detail: draft.detail,
    recommendation_class: draft.recommendation_class,
    status: 'open',
    last_state: 'detected',
    last_measured_check_id: place.ctx.check_id,
    first_seen_check_id: place.ctx.check_id,
    confidence: draft.confidence,
    affected_pages: draft.affected_pages,
    template_key: draft.template_key,
    crawler_uas: draft.crawler_uas,
    rank: draft.rank,
    effect: draft.effect,
    effort: draft.effort,
    before_after: draft.before_after,
    packet: draft.packet,
  };
}

function event(
  fix: Fix,
  kind: Exclude<FixEvent['kind'], 'marked_done'>,
  checkId: string,
  at: string,
): FixEvent {
  return {
    id: stableId('event', fix.id, checkId, kind),
    fix_id: fix.id,
    at,
    kind,
    check_id: checkId,
  };
}

/** Each fix's events in the order they happened: by time, then by id where two share an instant. */
function eventsByFix(fixes: readonly Fix[], events: readonly FixEvent[]): Map<string, FixEvent[]> {
  const out = new Map<string, FixEvent[]>(fixes.map((f) => [f.id, []]));
  for (const e of events) {
    const list = out.get(e.fix_id);
    if (!list) throw new Error(`diffCheck: event ${e.id} belongs to no fix given`);
    list.push(e);
  }
  for (const list of out.values()) {
    list.sort((a, b) => instant(a.at) - instant(b.at) || byText(a.id, b.id));
  }
  for (const f of fixes) {
    const status: FixStatus = statusOf(out.get(f.id)!);
    if (status !== f.status) {
      throw new Error(
        `diffCheck: fix ${f.id} has status ${f.status}, but its events say ${status}`,
      );
    }
  }
  return out;
}

/** Refuses input that contradicts itself, rather than diffing it into something plausible. */
function checkInput({ previous, current, fixes, outcomes }: DiffInput): void {
  const site = current.check.site_id;
  if (previous) {
    if (previous.check.site_id !== site)
      throw new Error('diffCheck: the previous check is another site’s');
    if (!graded(previous.check)) throw new Error('diffCheck: the previous check was not graded');
    if (instant(previous.check.finished_at!) >= instant(current.check.finished_at!)) {
      throw new Error('diffCheck: the previous check did not finish earlier than this one');
    }
  }
  const byFingerprint = new Map<string, Fix>();
  const numbers = new Set<number>();
  const ids = new Set<string>();
  for (const f of fixes) {
    if (f.site_id !== site) throw new Error(`diffCheck: fix ${f.id} is another site’s`);
    if (FIX_SECTION[f.type] !== f.section) {
      throw new Error(`diffCheck: fix ${f.id} is a ${f.type} in section ${f.section}`);
    }
    if (numbers.has(f.number)) throw new Error(`diffCheck: two fixes have number ${f.number}`);
    if (ids.has(f.id)) throw new Error(`diffCheck: two fixes have id ${f.id}`);
    numbers.add(f.number);
    ids.add(f.id);
    if (byFingerprint.has(f.fingerprint)) {
      throw new Error(`diffCheck: fingerprint ${f.fingerprint} is on two fixes`);
    }
    byFingerprint.set(f.fingerprint, f);
  }
  for (const side of previous ? [previous, current] : [current]) {
    const uas = side.check.crawlers.map((r) => r.ua);
    if (new Set(uas).size !== uas.length) {
      throw new Error(`diffCheck: check ${side.check.id} lists a crawler twice`);
    }
  }
  const reportedIndeterminate = outcomes
    .filter((o) => o.state === 'indeterminate')
    .map((o) => o.fingerprint)
    .sort(byText);
  if (reportedIndeterminate.join() !== [...current.indeterminate].sort(byText).join()) {
    throw new Error(
      'diffCheck: the check’s indeterminate fingerprints are not its indeterminate outcomes',
    );
  }
  const seen = new Set<string>();
  for (const o of outcomes) {
    if (seen.has(o.fingerprint))
      throw new Error(`diffCheck: fingerprint ${o.fingerprint} reported twice`);
    seen.add(o.fingerprint);
    const fix = byFingerprint.get(o.fingerprint);
    const type: FixType | undefined = o.state === 'detected' ? o.fix.type : fix?.type;
    if (o.state === 'detected' && fix && fix.type !== o.fix.type) {
      throw new Error(
        `diffCheck: fingerprint ${o.fingerprint} is a ${fix.type}, reported as type ${o.fix.type}`,
      );
    }
    if (o.state === 'detected' && FIX_SECTION[o.fix.type] !== o.fix.section) {
      throw new Error(`diffCheck: a ${o.fix.type} reported in section ${o.fix.section}`);
    }
    if (type && !current.detectors.includes(type)) {
      throw new Error(
        `diffCheck: an outcome for ${type}, whose detector did not run on this check`,
      );
    }
  }
}
