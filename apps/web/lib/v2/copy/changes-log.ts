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
  filtered: (shown: number, total: number, filters: readonly string[], entries = false) =>
    `${count(shown)} of ${count(total)} ${
      entries ? plural(total, 'entry', 'entries') : plural(total, 'change', 'changes')
    } match: ${filters.join(', ')}.`,
  /**
   * The rail's "N new", in words, and what it counts: the changes opened or resolved at each site's
   * latest check (`newChanges`).
   */
  newNote: (n: number) =>
    `${capitalise(numberWord(n))} ${plural(n, 'was', 'were')} opened or resolved at a site’s latest check.`,
  /** One row for what a site's first audit found (F-100): nothing has changed yet. */
  firstAudit: (n: number) => `First audit: ${count(n)} ${plural(n, 'issue', 'issues')} found.`,
  firstAuditWhere: 'the whole site',
  firstAuditCause: 'Nothing to compare yet. The next check of this site is compared with this one.',
  /** The same row once the site has been checked again. */
  firstAuditCauseLater: 'The baseline this site’s later checks are compared with.',
  /** The headline while every row is a first audit: they are not changes. */
  firstAuditsOnly: (n: number) =>
    `${capitalise(numberWord(n))} first ${plural(n, 'audit', 'audits')}. Changes appear once a site has been checked again.`,
  /** The same, once a site has been checked again and nothing differed. */
  firstAuditsNoChange: (n: number) =>
    `${capitalise(numberWord(n))} first ${plural(n, 'audit', 'audits')}. No later check has found a change.`,
  noChanges: 'No changes yet.',
  noMatch: 'No change matches these filters.',
  /** A site filter naming no site of this account, whether or not the id exists (F-130). */
  siteNotHere: 'That site is not one you can see here, so the filter on it is not applied.',
  allSites: 'All sites',
  allKinds: 'All kinds',
  groups: { site: 'Site', kind: 'Kind', since: 'Time' },
  filtersLabel: 'Filters',
  table: 'Changes across the account',
};
