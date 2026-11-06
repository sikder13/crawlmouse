/**
 * Writes src/v2/grade/expected.json. Run from packages/engine after changing the grade code:
 *   pnpm --filter @crawlmouse/engine exec tsx fixtures/v2/grade/write-expected.ts
 *
 * It refuses to record changed grades or effects under the same GRADE_VERSION: a change to what the
 * grades say is a new version (Check.grade_version), and the diff writes no change rows across two.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { GRADE_VERSION } from '../../../src/v2/grade/weights.js';
import { guardCases, sourceDigest } from './guard.js';

const out = new URL('../../../src/v2/grade/expected.json', import.meta.url);
const cases = guardCases();
const previous = JSON.parse(readFileSync(out, 'utf8')) as { grade_version: string; cases: unknown };
const changed = JSON.stringify(previous.cases) !== JSON.stringify(cases);
if (changed && previous.grade_version === GRADE_VERSION) {
  throw new Error(
    `The grades or effects changed under grade_version ${GRADE_VERSION}: bump GRADE_VERSION in src/v2/grade/weights.ts.`,
  );
}
const json = JSON.stringify({ grade_version: GRADE_VERSION, source_digest: sourceDigest(), cases });
writeFileSync(
  out,
  await format(json, { ...(await resolveConfig(out.pathname)), filepath: out.pathname }),
);
