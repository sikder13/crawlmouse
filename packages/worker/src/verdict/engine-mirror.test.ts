import { describe, expect, it } from 'vitest';
import { VerdictSchema, type AccessCause, type Verdict } from '@crawlmouse/types/v2';
import { CAUSES, EVIDENCE } from '../../../engine/src/v2/access/cells.js';
import { NOT_REQUESTED_ROW } from '../batch/access.js';
import type { ChallengeEvidence, ResponseReading } from './response.js';
import { DECISION_TABLE, decide, type Cell, type Observed } from './table.js';

/**
 * The engine refuses a crawler row whose cause or evidence class the worker never gives its verdict
 * (packages/engine/src/v2/access/cells.ts, CAUSES and EVIDENCE). Those two tables mirror this
 * package's decision table. This test enumerates the cells the table can be handed, over values that
 * reach each side of each condition, and the readings its cause rules read (outcome, challenge
 * evidence, 1020), plus the one row access.ts writes without the table, and holds what the worker can
 * write equal to what the engine accepts, in both directions.
 *
 * Only crawler rows are compared. The control's and the canary's rows (`ua` null) are the method,
 * which the engine does not read.
 */

const OBSERVED: Observed[] = [
  'served',
  'refused',
  'gone',
  'challenged',
  'rate_limited',
  'payment',
  'redirected_away',
  'error',
  'not_requested',
];

/** Every cell, over values that reach each side of each condition (THIN_RATIO is 0.8 of 500). */
function* cells(): Generator<Cell> {
  for (const robots of ['readable', 'blocks_site'] as const)
    for (const crawlerAllowed of [true, false])
      for (const oursAllowed of [true, false])
        for (const control of OBSERVED)
          for (const crawler of OBSERVED)
            for (const witnessed of [true, false])
              for (const words of [null, 0, 399, 400])
                for (const controlWords of [null, 0, 500])
                  for (const sameType of [true, false])
                    yield {
                      robots,
                      crawlerAllowed,
                      oursAllowed,
                      control,
                      crawler,
                      witnessed,
                      words,
                      controlWords,
                      sameType,
                    };
}

/**
 * The readings a request with this outcome can have (verdict/response.ts): none when it was not made;
 * a challenge recognised by any of the three kinds of evidence, or none; Cloudflare's 1020 only on
 * the 4xx outcomes, where response.ts looks for it.
 */
const EVIDENCE_KINDS: ChallengeEvidence[] = [
  'mitigation_header',
  'challenge_redirect',
  'body_signature',
];
// Every outcome response.ts can read from a 4xx: it looks for 1020 on any of them.
const FOUR_XX: Observed[] = ['refused', 'gone', 'challenged', 'rate_limited', 'payment'];
function readings(o: Observed): (ResponseReading | null)[] {
  if (o === 'not_requested') return [null];
  const challenges = [null, ...EVIDENCE_KINDS.map((evidence) => ({ evidence, marker: 'm' }))];
  const codes = FOUR_XX.includes(o) ? [false, true] : [false];
  return challenges.flatMap((challenge) =>
    codes.map((cloudflare1020) => ({ class: o, challenge, cloudflare1020 })),
  );
}

const key = (verdict: Verdict, part: string | null) => `${verdict} ${part ?? '—'}`;

function written(): { causes: Set<string>; evidence: Set<string>; rows: Set<string> } {
  const causes = new Set<string>();
  const evidence = new Set<string>();
  const rows = new Set<string>();
  for (const cell of cells()) {
    const row = decide(cell);
    rows.add(row.id);
    evidence.add(key(row.verdict, row.evidence));
    for (const control of readings(cell.control))
      for (const crawler of readings(cell.crawler))
        causes.add(key(row.verdict, row.cause.of({ control, crawler })));
  }
  // The rows access.ts writes without the table: every crawler on a page that was not requested.
  causes.add(key(NOT_REQUESTED_ROW.verdict, NOT_REQUESTED_ROW.cause));
  evidence.add(key(NOT_REQUESTED_ROW.verdict, NOT_REQUESTED_ROW.evidence));
  return { causes, evidence, rows };
}

function accepted(): { causes: Set<string>; evidence: Set<string> } {
  const causes = new Set<string>();
  const evidence = new Set<string>();
  for (const verdict of VerdictSchema.options) {
    for (const c of CAUSES[verdict] as readonly (AccessCause | null)[]) causes.add(key(verdict, c));
    for (const e of EVIDENCE[verdict]) evidence.add(key(verdict, e));
  }
  return { causes, evidence };
}

describe("the engine's cause and evidence tables mirror the decision table", () => {
  const w = written();
  const a = accepted();

  it('the enumeration reaches every row of the decision table', () => {
    expect([...w.rows].sort()).toEqual(DECISION_TABLE.map((r) => r.id).sort());
  });

  it('every verdict and cause the worker can write is one the engine accepts, and no other', () => {
    expect([...w.causes].sort()).toEqual([...a.causes].sort());
  });

  it('every verdict and evidence class the worker can write is one the engine accepts, and no other', () => {
    expect([...w.evidence].sort()).toEqual([...a.evidence].sort());
  });
});
