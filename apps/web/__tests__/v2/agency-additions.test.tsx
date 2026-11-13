/**
 * The words of this step's screens (Seats, the client matrix, the client page, client reports) that
 * no artboard is compared with. The lock comparison reads the preview that draws a locked artboard
 * and leaves out what sits inside a `data-v2-addition` marker (`_lib/lock.ts`); a preview of another
 * state, and the text inside a marker, it does not read.
 *
 * Here, on each preview of the four screens, as it renders and again as a live page draws it
 * (`LiveActions`), two sets of text nodes are read: those inside a marker, wherever it is, and
 * those of the page's `<main>`. Each must be a string the screen's view holds, a string of the
 * step's copy modules, or a word a shared component writes itself (`SHARED`); or such strings
 * joined by " · ", as a grade's score line is. A sentence typed into a component is none of these.
 *
 * What this does not see:
 * - a sentence added to a copy module or composed in a view: those are strings it allows, and the
 *   view's and the copy's own tests are what hold them;
 * - a string of the copy drawn where the data does not hold it. One such case is held elsewhere:
 *   seats.test.tsx counts the "Invited" pill against the view's rows;
 * - an attribute (`aria-label`, `placeholder`, `title`);
 * - a state no preview renders;
 * - the rail outside a marker, and any other screen.
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
import { PILL_STATES } from '../../components/v2/pill-states';
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

/**
 * What the shared components these screens use write themselves: the word a status pill speaks
 * before its label (`StatusPill`), and a grade that is withheld (`GradeHalf`,
 * components/v2/screens/site/SiteScreen.tsx).
 */
const SHARED = [
  ...Object.values(PILL_STATES).flatMap((s) => (s.spoken === null ? [] : [`${s.spoken}:`])),
  'withheld',
  '–',
];

/** The text nodes under each of `roots`, trimmed, without the empty ones; a node is read once. */
function textUnder(document: Document, roots: Iterable<Element>): string[] {
  const seen = new Set<Node>();
  const out: string[] = [];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (seen.has(n)) continue;
      seen.add(n);
      const text = (n.nodeValue ?? '').trim();
      if (text) out.push(text);
    }
  }
  return out;
}

const parse = (html: string) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;

/** The text inside each marker of `html`. */
function markedText(html: string): string[] {
  const document = parse(html);
  return textUnder(document, document.querySelectorAll('[data-v2-addition]'));
}

/** The text of the page of `html`: its `<main>`. */
function pageText(html: string): string[] {
  const document = parse(html);
  return textUnder(document, document.querySelectorAll('main'));
}

/** The text this guard reads: inside each marker of `html`, and in its `<main>`. */
function readText(html: string): string[] {
  const document = parse(html);
  return textUnder(document, document.querySelectorAll('[data-v2-addition], main'));
}

/** The text read from `html` that is not made of the view's, the copy's and the shared words. */
function typedIn(html: string, view: unknown): string[] {
  const allowed = new Set([...leaves(view), ...COPY, ...SHARED].map((s) => s.trim()));
  const made = (text: string) =>
    allowed.has(text) || text.split(' · ').every((part) => allowed.has(part.trim()));
  return readText(html).filter((t) => !made(t));
}

describe('the words of Seats, the matrix, the client page and client reports that no artboard is compared with', () => {
  it('finds a sentence typed into a marker or into the page, and lets the view’s and the copy’s strings through', () => {
    const view = { note: 'From the view.', score: 66 };
    expect(
      typedIn(
        `<p data-v2-addition="">From the view.</p><main><p>${SEATS_COPY.invited}</p></main>`,
        view,
      ),
    ).toEqual([]);
    const typed = 'Most agencies add three seats.';
    expect(typedIn(`<p data-v2-addition="">${typed}</p>`, view)).toEqual([typed]);
    expect(typedIn(`<main><p>${typed}</p></main>`, view)).toEqual([typed]);
    // A marker inside the page is read once.
    expect(typedIn(`<main><p data-v2-addition="">${typed}</p></main>`, view)).toEqual([typed]);
    // Outside both (the rail), the text is not read here.
    expect(typedIn(`<nav><p>${typed}</p></nav>`, view)).toEqual([]);
  });

  it('lets strings joined by " · " through when each is allowed, and a status pill’s spoken word', () => {
    const view = { note: 'From the view.', score: 66 };
    expect(typedIn('<main><span>66 · From the view.</span></main>', view)).toEqual([]);
    expect(typedIn('<main><span>66 · typed here</span></main>', view)).toEqual(['66 · typed here']);
    expect(typedIn('<main><span>Warning: </span><span>withheld</span></main>', view)).toEqual([]);
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

  it.each(SCREENS)(
    '%s: the text in its markers and its page is the view’s, the copy’s or a shared word',
    (_path, view, el) => {
      const html = renderToStaticMarkup(el());
      // The page is found and holds text: a render with no `<main>` would be read as nothing.
      expect(pageText(html).length).toBeGreaterThan(0);
      expect(typedIn(html, view)).toEqual([]);
      expect(typedIn(renderToStaticMarkup(<LiveActions>{el()}</LiveActions>), view)).toEqual([]);
    },
  );
});
