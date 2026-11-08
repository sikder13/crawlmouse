/**
 * The account Changes log's written sentences. It has no artboard (D3), so it has no lock
 * corrections; every number in these sentences is a parameter the view model counts.
 */
import { capitalise, count, numberWord, plural } from '../words';

export const CHANGES_LOG_COPY = {
  title: 'Changes',
  /** Unfiltered: how many changes, on how many sites. */
  headline: (changes: number, sites: number) =>
    `${count(changes)} ${plural(changes, 'change', 'changes')} across ${count(sites)} ${plural(sites, 'site', 'sites')}, newest first.`,
  /** Filtered: how many of the account's changes the filters keep, and which filters. */
  filtered: (shown: number, total: number, filters: readonly string[]) =>
    `${count(shown)} of ${count(total)} ${plural(total, 'change', 'changes')} match: ${filters.join(', ')}.`,
  /**
   * The rail's "N new", in words, and what it counts: the changes opened or resolved at each site's
   * latest check (`newChanges`).
   */
  newNote: (n: number) =>
    `${capitalise(numberWord(n))} ${plural(n, 'was', 'were')} opened or resolved at a site’s latest check.`,
  noChanges:
    'No changes yet. A change is something a check finds that differs from the check before.',
  noMatch: 'No change matches these filters.',
  allSites: 'All sites',
  allKinds: 'All kinds',
  groups: { site: 'Site', kind: 'Kind', since: 'Since' },
  filtersLabel: 'Filters',
  /** A filter group's name for a screen reader: "Filter by site". */
  filterBy: (name: string) => `Filter by ${name.toLowerCase()}`,
  table: 'Changes across the account',
};
