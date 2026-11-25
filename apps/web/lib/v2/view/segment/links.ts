/**
 * Links and pages (row 5): the segment page's view, on the facts links-facts.ts reads from the
 * check's record, which the overview's door and the PDF read too.
 */
import { findCheck } from '../../fixtures';
import { count, plural } from '../../words';
import type { DoorView } from '../result';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';
import {
  ERRORS_HEADING,
  HEADINGS_LINE,
  linksFacts,
  type BasicsColumnView,
  type ErrorRowView,
  type LinksCounts,
  type RedirectRowView,
} from './links-facts';
import type { ViewDataset } from '../../fixtures';

export * from './links-facts';

export interface LinksView {
  frame: SegmentFrame;
  /** The pill is null when the record holds no page: nothing was measured to pill. */
  headline: { title: string; pill: DoorView['pill'] | null };
  body: string;
  tiles: { label: string; value: string; note: string | null }[];
  coverage: { read: string };
  counts: LinksCounts;
  broken: { rows: ErrorRowView[]; empty: string | null };
  /** Missing pages the record links to from 0 pages; listed only when there is one. */
  unlinked: { heading: string; rows: ErrorRowView[] };
  /** Pages that answered an error other than missing; listed only when there is one. */
  errors: { heading: string; rows: ErrorRowView[] };
  redirects: { rows: RedirectRowView[]; empty: string | null };
  titles: BasicsColumnView;
  descriptions: BasicsColumnView;
  headings: string;
  keep: { title: string; sub: string } | null;
}

export function linksView(
  d: ViewDataset,
  checkId: string,
  options: SegmentOptions = {},
): LinksView {
  const check = findCheck(d, checkId);
  const frame = segmentFrame(d, checkId, 'links', options);
  const f = linksFacts(d, check);
  const c = f.counts;
  const measured = c.checked > 0;
  const crawled = check.coverage?.pages_crawled ?? null;
  const scope =
    crawled !== null && crawled > c.checked
      ? `${count(c.checked)} ${plural(c.checked, 'page', 'pages')} checked: `
      : '';
  /** A tile's value: its count, or what stands in for it when the count was not read. */
  const tile = (label: string, n: number, unread: string | null) => ({
    label,
    value: !measured ? 'not measured' : (unread ?? count(n)),
    note: null,
  });
  // The missing pages the record holds, however they are linked, and whether any link was read.
  const missing = c.broken + c.missingUnlinked;
  const linkPart = `${count(missing)} missing ${plural(missing, 'page', 'pages')} found`;
  const redirectPart = c.redirectsRecorded
    ? `${count(c.redirects)} ${plural(c.redirects, 'redirect', 'redirects')}`
    : 'redirects not recorded';
  const basicsPart =
    c.titlesRead === c.descriptionsRead
      ? `titles and descriptions read on ${count(c.titlesRead)} ${plural(c.titlesRead, 'page', 'pages')}`
      : `titles read on ${count(c.titlesRead)} ${plural(c.titlesRead, 'page', 'pages')}, descriptions on ${count(c.descriptionsRead)}`;
  return {
    frame,
    headline: {
      title: measured
        ? `${scope}${linkPart} · ${redirectPart} · ${basicsPart}`
        : 'Links and pages were not measured',
      pill: measured ? f.pill : null,
    },
    body: f.screenBody,
    tiles: [
      tile('Missing pages found', missing, null),
      tile('Redirects', c.redirects, c.redirectsRecorded ? null : 'not recorded'),
      tile('Missing titles', c.missingTitles, c.titlesRead ? null : 'not read'),
      tile('Missing descriptions', c.missingDescriptions, c.descriptionsRead ? null : 'not read'),
    ],
    coverage: { read: f.coverage },
    counts: c,
    broken: { rows: f.broken, empty: f.brokenEmpty },
    unlinked: { heading: f.unlinkedHeading, rows: f.unlinked },
    errors: { heading: ERRORS_HEADING, rows: f.errors },
    redirects: { rows: f.redirects, empty: f.redirectsEmpty },
    titles: f.titles,
    descriptions: f.descriptions,
    headings: HEADINGS_LINE,
    keep: frame.keptUntil
      ? {
          title: `Keep this audit: an account re-checks the site monthly, and this page is rebuilt from each check.`,
          sub: `One email creates a free account that re-checks monthly, with 14 days of Pro to start. Otherwise this page expires ${frame.keptUntil}.`,
        }
      : null,
  };
}
