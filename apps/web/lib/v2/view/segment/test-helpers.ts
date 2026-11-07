/**
 * Shared by the segment view-model tests: a fixture's first audit, the check each segment preview
 * shows, and a way to edit a copy of it before building a view.
 */
import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { findCheck, fixture, type FixtureName } from '../../fixtures';
import { CHECKS } from '../../recordings';

export const FIRST_AUDIT: Record<FixtureName, string> = {
  'bad-site': CHECKS.badFirstAudit,
  'clean-site': CHECKS.cleanFirstAudit,
  'challenged-site': CHECKS.challengedFirstAudit,
  // The check builder's one check (CC-20a), read from the fixture rather than repeated here.
  'built-site': fixture('built-site').checks[0]!.id,
};

/** A copy of fixture `name` with `edit` applied to its first audit, and that audit's id. */
export function edited(
  name: FixtureName,
  edit: (c: Check, d: FixtureDataset) => void = () => {},
): { d: FixtureDataset; id: string; check: Check } {
  const d = structuredClone(fixture(name));
  const id = FIRST_AUDIT[name];
  const check = findCheck(d, id);
  edit(check, d);
  return { d, id, check };
}

/** The bad site is previewed as it was first seen, before its owner kept it (as the Result is). */
export const asFirstSeen = (name: FixtureName) => name === 'bad-site';
