/**
 * D-17's rule, every time on an account page names its zone, read from the rendered pages this
 * change touches: Alerts, Trial ending and the Agency client reports. Each preview is rendered, every
 * clock time in its text is found, and the test fails on any time with no zone after it. Read from
 * the page, not listed, so a time added later is held to the rule too.
 */
import { JSDOM } from 'jsdom';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_REPORTS_PREVIEWS,
  clientReportsPreview,
  type ClientReportsPreview,
} from '../../app/(v2-preview)/v2-preview/_preview/agency-reports';
import { alertsPreview, trialEndPreview } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import { ClientReportsScreen } from '../../components/v2/screens/agency/ReportsScreen';
import { AlertsScreen } from '../../components/v2/screens/alerts/AlertsScreen';
import { TrialEndScreen } from '../../components/v2/screens/trial-end/TrialEndScreen';

const PAGES: Record<string, () => ReactElement> = {
  'Alerts (home)': () => <AlertsScreen data={alertsPreview('home')} />,
  'Alerts (clean)': () => <AlertsScreen data={alertsPreview('clean')} />,
  'Trial ending': () => <TrialEndScreen data={trialEndPreview()} />,
  ...Object.fromEntries(
    (Object.keys(CLIENT_REPORTS_PREVIEWS) as ClientReportsPreview[]).map((path) => [
      `Client reports ${path}`,
      () => <ClientReportsScreen data={clientReportsPreview(path)} />,
    ]),
  ),
};

/**
 * What may follow a time: an abbreviation ("EDT", read before the next word even where the markup
 * runs them together), a full zone name ("America/Denver"), or a client report's "their time", the
 * recipient's own zone, which the row's next run then names in full.
 */
const ZONED = /^ ?(?:[A-Z]{2,5}(?![a-z])|GMT[+-]\d|[A-Z][a-z]+\/[A-Za-z_]+|their time)/;

/** Each clock time in the page's text and the twenty characters after it. */
function times(page: ReactElement): string[][] {
  const doc = new JSDOM(renderToStaticMarkup(page)).window.document;
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ');
  return [...text.matchAll(/(?<!\d)\d{2}:\d{2}(?!\d)(.{0,20})/g)].map((m) => [m[0], m[1]!]);
}

describe('every time on these pages names its zone (D-17)', () => {
  for (const [name, page] of Object.entries(PAGES)) {
    it(name, () => {
      const found = times(page());
      const unzoned = found.filter(([, after]) => !ZONED.test(after!)).map(([t]) => t);
      expect(unzoned).toEqual([]);
    });
  }

  it('reads some times, so a page that shows none does not pass for the wrong reason', () => {
    const counts = Object.fromEntries(
      Object.entries(PAGES).map(([n, p]) => [n, times(p()).length]),
    );
    expect(counts['Alerts (home)']).toBeGreaterThan(0);
    expect(counts['Trial ending']).toBeGreaterThan(0);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(5);
  });
});
