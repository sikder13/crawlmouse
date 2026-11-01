/**
 * How loud a change is, for alerts (ARCH-2 §4.5): an opened fix worth at least
 * BAD_AI_READABILITY_POINTS of AI readability or BAD_TECHNICAL_SEO_POINTS of technical SEO is `bad`,
 * any other opened change `warn`, a resolved one `info`. ARCH-2 does not grade a `changed` row, so it
 * has none.
 *
 * It is computed where it is needed, never stored: Change has no field for it.
 */
import type { Change, Fix } from '@crawlmouse/types/v2';

/** Provisional, as ARCH-2 states them: the ground-truth corpus (CC-18) may replace both. */
export const BAD_AI_READABILITY_POINTS = 10;
export const BAD_TECHNICAL_SEO_POINTS = 4;

export type Severity = 'bad' | 'warn' | 'info';

/** `fix` is the fix the change opened or resolved, null when it has none. */
export function severityOf(
  change: Pick<Change, 'kind'>,
  fix: Pick<Fix, 'effect'> | null,
): Severity | null {
  if (change.kind === 'resolved') return 'info';
  if (change.kind !== 'opened') return null;
  const effect = fix?.effect;
  const large =
    effect !== undefined &&
    ((effect.ai_readability ?? 0) >= BAD_AI_READABILITY_POINTS ||
      effect.technical_seo >= BAD_TECHNICAL_SEO_POINTS);
  return large ? 'bad' : 'warn';
}
