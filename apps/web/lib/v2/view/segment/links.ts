/**
 * Links and pages (row 5): the segment page's view, on the facts links-facts.ts reads from the
 * check's record, which the overview's door and the PDF read too.
 */
import { findCheck } from '../../fixtures';
import { count, plural } from '../../words';
import type { DoorView } from '../result';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';
import {
  BROKEN_EMPTY,
  HEADINGS_LINE,
  REDIRECTS_EMPTY,
  linksFacts,
  type BasicsColumnView,
  type BrokenRowView,
  type LinksCounts,
  type RedirectRowView,
} from './links-facts';
import type { ViewDataset } from '../../fixtures';

export * from './links-facts';

export interface LinksView {
  frame: SegmentFrame;
  headline: { title: string; pill: DoorView['pill'] };
  body: string;
  tiles: { label: string; value: string; note: string | null }[];
  coverage: { read: string };
  counts: LinksCounts;
  broken: { rows: BrokenRowView[]; empty: string | null };
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
  return {
    frame,
    headline: {
      title: `${count(c.broken)} broken ${plural(c.broken, 'link', 'links')} · ${count(c.redirects)} ${plural(c.redirects, 'redirect', 'redirects')} · titles and descriptions for ${count(c.served)} ${plural(c.served, 'page', 'pages')}`,
      pill: f.pill,
    },
    body: f.body,
    tiles: [
      { label: 'Broken links', value: count(c.broken), note: null },
      { label: 'Redirects', value: count(c.redirects), note: null },
      { label: 'Missing titles', value: count(c.missingTitles), note: null },
      { label: 'Missing descriptions', value: count(c.missingDescriptions), note: null },
    ],
    coverage: { read: f.coverage },
    counts: c,
    broken: { rows: f.broken, empty: f.broken.length ? null : BROKEN_EMPTY },
    redirects: { rows: f.redirects, empty: f.redirects.length ? null : REDIRECTS_EMPTY },
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
