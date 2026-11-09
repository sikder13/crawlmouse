/**
 * Which view-model text a screen may keep out of sight on a phone (owner ruling 2026-11-08): only
 * secondary text, a description or a helper line, and only out of sight, never out of the
 * accessibility tree. Every other text a view model holds is data, a price, an action or decision
 * text, and shows at every width.
 *
 * The screens mark what they hide with `data-v2-phone-secondary`;
 * `__tests__/v2/phone-secondary.test.tsx` requires each marked text to be one these fields hold,
 * and `tests/visual/layout.spec.ts` that a phone shows every other text and keeps these in the
 * accessibility tree.
 */
import type { ShellView } from './account-shell';
import type { SiteView } from './site';

/** The fields, by where they sit in the views, and why each is secondary. */
export const PHONE_SECONDARY_FIELDS = [
  'ShellView.trial.note: the trial card’s description of what follows the trial',
  'SiteView.fixes.rows[].note: a fix’s history, a helper line beside its status',
] as const;

/** The secondary texts one screen's views hold, in the fields above. */
export function phoneSecondaryTexts(shell: ShellView, site?: SiteView): string[] {
  return [shell.trial?.note ?? null, ...(site?.fixes.rows.map((r) => r.note) ?? [])].filter(
    (t): t is string => t !== null && t !== '',
  );
}
