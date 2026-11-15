/**
 * CC-36 D5 on the screen: the earlier-audits line is one closed disclosure in the sites card, drawn
 * only when the view carries it, in the empty state and in the sites state alike.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardScreen } from './DashboardScreen';
import {
  PREVIEW_EARLIER_AUDITS,
  dashboardPreview,
  noSiteEarlierPreview,
  noSitePreview,
} from '../../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { dashboardView } from '../../../../lib/v2/view/dashboard';
import { fixture } from '../../../../lib/v2/fixtures';

const dom = (data: Parameters<typeof DashboardScreen>[0]['data']) =>
  new JSDOM(renderToStaticMarkup(<DashboardScreen data={data} />)).window.document;

describe('the earlier-audits line on the dashboard', () => {
  it('is absent without earlier audits, in both states', () => {
    expect(dom(noSitePreview()).querySelector('[data-v2-earlier-audits]')).toBeNull();
    expect(dom(dashboardPreview('home')).querySelector('[data-v2-earlier-audits]')).toBeNull();
  });

  it('in the empty state is a closed <details> in the sites card, its summary the line, one link per audit', () => {
    const doc = dom(noSiteEarlierPreview());
    const d = doc.querySelectorAll('details[data-v2-earlier-audits]');
    expect(d).toHaveLength(1);
    const details = d[0] as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.hasAttribute('data-v2-addition')).toBe(true);
    expect(details.closest('section')?.querySelector('h2, h3')?.textContent).toBe('Sites');
    expect(details.querySelector('summary')?.textContent).toBe(
      'Your earlier audits are still at their links',
    );
    expect(details.querySelector('ul')?.getAttribute('aria-label')).toBe('Earlier audits');
    expect([...details.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      // 10:00Z on 19 Oct, 14:20Z on 12 Oct and 09:05Z on 3 Jun are the same dates in Indiana (UTC−4).
      'example-outfitter.com · 19 Oct 2026 · earlier grade B',
      'example-outfitter.com · 12 Oct 2026 · earlier grade C',
      'blog.example-outfitter.com · 3 Jun 2026 · not graded',
    ]);
    // A host audited twice keeps two link names: the date and grade are in each.
    expect([...details.querySelectorAll('a')].map((a) => a.getAttribute('aria-label'))).toEqual([
      'example-outfitter.com, 19 Oct 2026, earlier grade B',
      'example-outfitter.com, 12 Oct 2026, earlier grade C',
      'blog.example-outfitter.com, 3 Jun 2026, not graded',
    ]);
    expect([...details.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(
      PREVIEW_EARLIER_AUDITS.map((a) => `/audit/${a.id}`),
    );
  });

  it('in the sites state is drawn in the sites card too', () => {
    const bad = fixture('bad-site');
    const data = dashboardView(
      bad,
      { accountId: 'a0000000-0000-4000-8000-000000000001', now: bad.as_of },
      undefined,
      PREVIEW_EARLIER_AUDITS,
    );
    const details = dom(data).querySelector('details[data-v2-earlier-audits]');
    expect(details?.closest('section')?.querySelector('table')?.getAttribute('aria-label')).toBe(
      'Watched sites',
    );
  });
});
