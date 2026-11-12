/**
 * `buildPublicSnapshot` (CC-29 D6): the v2 public report's snapshot, a pure function of a finished
 * check's dataset. It is made from the overview's own view functions, so the report and the audit
 * page cannot disagree about a count or a sentence. It takes from a fix its title, its scope and its
 * estimated points, never its packet: no packet body, command or check reaches a snapshot
 * (`build-snapshot.test.ts` walks every string to prove it).
 */
import type { Check } from '@crawlmouse/types/v2';
import { keptOutClauses, thinSentence } from '../sentences';
import { findCheck, siteOf, type ViewDataset } from '../fixtures';
import { CAUSE_SHORT } from '../view/segment/access';
import { crawlerRows, resultView } from '../view/result';
import { freeFixes } from '../view/free-fixes';
import { PublicSnapshotV2Schema, type PublicSnapshotV2 } from './snapshot';

function headline(check: Check, host: string): string {
  const keptOut = keptOutClauses(check.crawlers);
  const thin = thinSentence(check);
  const sentences = [
    ...(keptOut.length ? [`${keptOut.join('; ')}.`] : []),
    ...(thin ? [thin] : []),
  ];
  return sentences.length
    ? sentences.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
    : `Every crawler we tested reads ${host}.`;
}

/**
 * The snapshot of a finished (or partial) check, minted at `mintedAt`. Throws for a check that has not
 * finished, as the overview does.
 */
export function buildPublicSnapshot(
  d: ViewDataset,
  checkId: string,
  mintedAt: string,
): PublicSnapshotV2 {
  const check = findCheck(d, checkId);
  const view = resultView(d, checkId, { map: null });
  const opened = new Set(freeFixes(d, check).map((f) => f.id));
  const rows = (view.fixes?.rows ?? []).filter((r) => opened.has(r.key));
  return PublicSnapshotV2Schema.parse({
    version: 2,
    host: siteOf(d, check).host,
    checkedAt: check.finished_at,
    mintedAt,
    headline: headline(check, view.domain),
    grades: view.grades.map(({ label, letter, score, withheld, summary }) => ({
      label,
      letter,
      score,
      withheld,
      summary,
    })),
    pagesCrawled: check.coverage!.pages_crawled,
    fixCount: view.fixes?.total ?? 0,
    crawlers: crawlerRows(check).map((row, i) => {
      const { scored, cause } = check.crawlers[i]!;
      const { ua, group, verdict, status, text } = row;
      return { ua, group, scored, verdict, status, text, cause: cause && CAUSE_SHORT[cause] };
    }),
    topFixes: rows.map(({ title, scope, points }) => ({ title, scope, points })),
  });
}
