/**
 * The Agency trial page, where the card is taken, names only capabilities it can account for (SEO
 * review 2, Q27): each capability phrase is tagged with For agencies' `CAPABILITIES`, each coming one
 * carries the "coming" mark, and nothing says Branding can be set today.
 */
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { capabilitySweep } from '../../../../__tests__/helpers/capability-sweep';
import { agencyTrialView, type AgencyAccountRow } from '../../../../lib/v2/view/agency-trial';
import { AgencyTrialScreen } from './AgencyTrialScreen';

const NOW = new Date('2026-11-12T12:00:00Z');
const row: AgencyAccountRow = {
  id: 'a0000000-0000-4000-8000-00000000000b',
  role: 'owner',
  name: 'Summit Digital',
  state: 'free',
  tier: 'free',
  pastDueTier: null,
  pastDueSince: null,
  trialVariant: null,
  trialEndsAt: null,
  trialUsedAt: null,
  subscriptionId: null,
  billingEnd: null,
  firstSite: 'clientsite.com',
};

const render = (interval: 'month' | 'year', open: AgencyAccountRow | null) =>
  renderToStaticMarkup(
    <AgencyTrialScreen
      view={agencyTrialView(
        {
          email: 'me@summit.agency',
          interval,
          timeZone: 'UTC',
          standing: { held: false, billing: [], used: null, open },
          customers: new Map(),
          cancelAsked: null,
        },
        NOW,
      )}
    />,
  );

const pages = (['month', 'year'] as const).flatMap((interval) =>
  [null, row].map(
    (open) => [`${interval}, ${open ? 'returning' : 'new'}`, render(interval, open)] as const,
  ),
);

describe('the Agency trial page names only capabilities it can account for', () => {
  it.each(pages)('%s', (_name, html) => {
    const r = capabilitySweep(html);
    expect(r.tagged).toBeGreaterThan(10);
    // Not a vacuous run: the page still names capabilities that are coming (fewer since CC-31's
    // merge built five of them).
    expect(r.seen).toBeGreaterThan(3);
    expect(r.unknown).toEqual([]);
    expect(r.unmarked).toEqual([]);
    expect(r.overMarked).toEqual([]);
    expect(r.loose).toEqual([]);
  });

  // Q47 (owner ruling): where the offer names scheduled client reports, the page says where a report
  // goes while the trial runs, once, inside the aside that makes the promise.
  it.each(pages)(
    '%s: says where a report goes during the trial, beside the reports it offers',
    (_n, html) => {
      const aside = new JSDOM(html).window.document.querySelector('section table')!.parentElement!;
      const text = aside.textContent!.replace(/\s+/g, ' ');
      expect(text).toContain('Scheduled client reports');
      expect(text.split('During the trial, reports go to your own address.')).toHaveLength(2);
      expect(html.split('During the trial, reports go to your own address.')).toHaveLength(2);
    },
  );

  // SEO R2-N5: where the card is taken, a row marked coming does not say "yes" beside it.
  it('the aside gives a coming row the value "coming", never "yes"', () => {
    for (const [, html] of pages) {
      const rows = [
        ...new JSDOM(html).window.document.querySelectorAll<HTMLTableRowElement>(
          'table[aria-label="What Agency includes"] tr',
        ),
      ];
      expect(rows.length).toBeGreaterThan(5);
      const values = rows.map((tr) => [
        tr.cells[0]!.querySelector('[data-v2-coming]') !== null,
        tr.cells[1]!.textContent,
      ]);
      expect(values.filter(([coming, value]) => coming && value === 'yes')).toEqual([]);
      expect(values.filter(([coming, value]) => !coming && value === 'coming')).toEqual([]);
      expect(values.some(([, value]) => value === 'coming')).toBe(true);
    }
  });

  it('does not say a domain and logo can be set under Branding', () => {
    for (const [, html] of pages) expect(html).not.toMatch(/Branding/);
  });
});
