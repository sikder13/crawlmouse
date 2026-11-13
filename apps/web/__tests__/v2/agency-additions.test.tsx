/**
 * What is drawn inside a `data-v2-addition` marker on this step's screens (Seats, the client
 * matrix, the client page, client reports). The lock comparison leaves those elements out
 * (`_lib/lock.ts`), so their text is compared with no artboard. Here each text node inside a marker
 * must be a string the screen's view holds or a string of the step's copy modules, on each preview
 * and again as a live page draws it (`LiveActions`): a sentence typed into a component is neither.
 *
 * What this does not see: a sentence added to a copy module or composed in a view (those are
 * strings it allows); an attribute (`aria-label`, `placeholder`); a state no preview renders; and
 * a marker on any other screen.
 */
import { JSDOM } from 'jsdom';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AGENCY_PREVIEWS,
  CLIENT_PREVIEWS,
  agencyPreview,
  clientPreview,
  type AgencyPreview,
  type ClientPreview,
} from '../../app/(v2-preview)/v2-preview/_preview/agency';
import {
  CLIENT_REPORTS_PREVIEWS,
  clientReportsPreview,
  type ClientReportsPreview,
} from '../../app/(v2-preview)/v2-preview/_preview/agency-reports';
import {
  SEATS_PREVIEWS,
  seatsPreview,
  type SeatsPreview,
} from '../../app/(v2-preview)/v2-preview/_preview/seats';
import { LiveActions } from '../../components/v2/screens/account/LiveActions';
import { AGENCY_RAIL_COPY, CLIENT_COPY, MATRIX_COPY } from '../../lib/v2/copy/agency';
import { CLIENT_REPORTS_COPY } from '../../lib/v2/copy/client-reports';
import { SEATS_COPY } from '../../lib/v2/copy/seats';
import { CC31_ELEMENTS, CC31_SEAT_ELEMENTS } from './_lib/screens';

/** Every string in a value, and every number as its digits. */
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

const COPY = leaves([AGENCY_RAIL_COPY, MATRIX_COPY, CLIENT_COPY, CLIENT_REPORTS_COPY, SEATS_COPY]);

/** Each preview of the four screens: its path, its view and the element that draws it. */
const SCREENS: [string, unknown, () => ReactElement][] = [
  ...(Object.keys(SEATS_PREVIEWS) as SeatsPreview[]).map(
    (p) => [p, seatsPreview(p), CC31_SEAT_ELEMENTS[p]!] as [string, unknown, () => ReactElement],
  ),
  ...(Object.keys(AGENCY_PREVIEWS) as AgencyPreview[]).map(
    (p) => [p, agencyPreview(p), CC31_ELEMENTS[p]!] as [string, unknown, () => ReactElement],
  ),
  ...(Object.keys(CLIENT_PREVIEWS) as ClientPreview[]).map(
    (p) => [p, clientPreview(p), CC31_ELEMENTS[p]!] as [string, unknown, () => ReactElement],
  ),
  ...(Object.keys(CLIENT_REPORTS_PREVIEWS) as ClientReportsPreview[]).map(
    (p) => [p, clientReportsPreview(p), CC31_ELEMENTS[p]!] as [string, unknown, () => ReactElement],
  ),
];

/** The text nodes inside each marker of `html`, trimmed, without the empty ones. */
function markedText(html: string): string[] {
  const { document, NodeFilter } = new JSDOM(`<!doctype html><body>${html}</body>`).window;
  const out: string[] = [];
  for (const marker of document.querySelectorAll('[data-v2-addition]')) {
    const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.nodeValue ?? '').trim();
      if (text) out.push(text);
    }
  }
  return out;
}

/** The marked text of `html` that is neither a string of `view` nor one of the copy modules. */
function typedIn(html: string, view: unknown): string[] {
  const allowed = new Set([...leaves(view), ...COPY].map((s) => s.trim()));
  return markedText(html).filter((t) => !allowed.has(t));
}

describe('the text inside an addition marker on Seats, the matrix, the client page and client reports', () => {
  it('finds a sentence typed into a marker, and lets the view’s and the copy’s strings through', () => {
    const view = { note: 'From the view.' };
    expect(
      typedIn(
        `<p data-v2-addition="">From the view.</p><p data-v2-addition="">${SEATS_COPY.invited}</p>`,
        view,
      ),
    ).toEqual([]);
    expect(typedIn('<p data-v2-addition="">Most agencies add three seats.</p>', view)).toEqual([
      'Most agencies add three seats.',
    ]);
    // Outside a marker the lock comparison reads the text, not this.
    expect(typedIn('<p>Most agencies add three seats.</p>', view)).toEqual([]);
  });

  it('reads markers on Seats, the matrix and client reports; the client page’s previews draw none', () => {
    const marked = (of: RegExp) =>
      SCREENS.filter(([path]) => of.test(path)).flatMap(([, , el]) =>
        markedText(renderToStaticMarkup(<LiveActions>{el()}</LiveActions>)),
      ).length;
    const [seats, client, reports] = [
      /\/screens\/seats(\/|$)/,
      /\/screens\/agency\/client(\/|$)/,
      /\/screens\/agency\/reports(\/|$)/,
    ];
    expect(marked(seats)).toBeGreaterThan(0);
    expect(marked(reports)).toBeGreaterThan(0);
    expect(marked(client)).toBe(0);
    const matrix = SCREENS.filter(([path]) => ![seats, client, reports].some((r) => r.test(path)));
    expect(matrix.map(([path]) => path)).toContain('/v2-preview/screens/agency');
    expect(
      matrix.flatMap(([, , el]) => markedText(renderToStaticMarkup(el()))).length,
    ).toBeGreaterThan(0);
  });

  it.each(SCREENS)('%s: each is a string of the view or of the copy modules', (_path, view, el) => {
    expect(typedIn(renderToStaticMarkup(el()), view)).toEqual([]);
    expect(typedIn(renderToStaticMarkup(<LiveActions>{el()}</LiveActions>), view)).toEqual([]);
  });
});
