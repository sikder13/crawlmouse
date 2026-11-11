/**
 * Which fixes the Free plan opens, in one place: the Result page, the segments and the fix page
 * all ask here, so they cannot disagree. The rule is by position: the first FREE_FIXES of the
 * audit's live fixes in the order `fixesAsOf` gives (rank, then number). On the fixture that is
 * not "ranks 1 to 3", because the bad site's first audit has no live rank-3 fix (its rank-3 fix
 * was first seen later), so the third free fix there has rank 4.
 */
import type { Check, Fix } from '@crawlmouse/types/v2';
import { fixesAsOf } from '../fixtures';
import type { ViewDataset } from './dataset';

/** How many of an audit's fixes Free opens (FACTS: "3 fixes per audit"). */
export const FREE_FIXES = 3;

/** The fixes Free opens at `check`, in order. */
export function freeFixes(d: ViewDataset, check: Check): Fix[] {
  return fixesAsOf(d, check).slice(0, FREE_FIXES);
}

/** What a reader's plan opens of an audit's fixes: the Free ones, or each live fix. */
export type FixPlan = 'free' | 'pro';

/** The fixes `plan` opens at `check`, in order: the live fixes on a paid plan, Free's otherwise. */
export function openFixes(d: ViewDataset, check: Check, plan: FixPlan = 'free'): Fix[] {
  return plan === 'pro' ? fixesAsOf(d, check) : freeFixes(d, check);
}

/** Whether Free opens `fix` at `check`. A fix of another site, or one resolved by then, is not open. */
export function isFreeFix(d: ViewDataset, check: Check, fix: Pick<Fix, 'id'>): boolean {
  return freeFixes(d, check).some((f) => f.id === fix.id);
}
