/**
 * The crawl screen of a real check has no link that goes nowhere (CC-22b D4). "How the grade is
 * calculated" has no route in this step, so a real page shows it only when it is given one; the
 * replay, which has no page around it, shows it as the design has it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { INITIAL_STATE } from '../../../../lib/v2/progress';
import { LiveCrawlScreen, type LiveControls } from './CrawlScreen';

const LABEL = 'How the grade is calculated';
const live: LiveControls = {
  onCancel: () => undefined,
  cancelling: false,
  sendEmail: async () => 'stored',
  emailDoes: 'Said under the field.',
  notices: [],
};
const render = (controls: LiveControls) =>
  renderToStaticMarkup(
    <LiveCrawlScreen
      source={{ subscribe: () => () => undefined, getState: () => INITIAL_STATE }}
      context={{ domain: 'shop.example', crawlers: [] }}
      resultHref="/audit/0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11"
      live={controls}
    />,
  );

describe('the crawl screen of a real check', () => {
  it('has no href="#", and no grade link when the page gives it no address', () => {
    const markup = render(live);
    expect(markup).toContain('While this runs');
    expect(markup).not.toContain('href="#"');
    expect(markup).not.toContain(LABEL);
  });

  it('shows the grade link at the address the page gives', () => {
    const markup = render({ ...live, gradeHref: '/guides/how-the-grade-works' });
    expect(markup).toMatch(
      new RegExp(`<a[^>]*href="/guides/how-the-grade-works"[^>]*>${LABEL}</a>`),
    );
    expect(markup).not.toContain('href="#"');
  });
});

describe('a real check waiting for a crawler, after discovery (CC-42A decisions 4 and 5)', () => {
  const withState = (state: typeof INITIAL_STATE) =>
    renderToStaticMarkup(
      <LiveCrawlScreen
        source={{ subscribe: () => () => undefined, getState: () => state }}
        context={{ domain: 'shop.example', crawlers: [] }}
        resultHref="/audit/0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11"
        live={live}
      />,
    );
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('shows "In line", how long it has waited, and what discovery found', () => {
    const state = {
      ...INITIAL_STATE,
      elapsed_ms: 75_000,
      waiting_since_ms: 15_000,
      discovery: { robots_txt: 'not_found' as const, sitemap_urls: 1240 },
    };
    const t = text(withState(state));
    expect(t).toContain('In line');
    expect(t).toContain('Waiting for a free crawler · 1:00');
    expect(t).toContain('No robots.txt');
    expect(t).toContain('Sitemap: 1,240 URLs read');
    expect(t).toContain('1:15 elapsed, 0 pages so far.');
    expect(t).not.toMatch(/usually about two minutes/i);
  });

  it('shows neither before discovery, or while no wait is on', () => {
    const t = text(withState(INITIAL_STATE));
    expect(t).not.toContain('In line');
    expect(t).not.toContain('Waiting for a free crawler');
    expect(t).not.toContain('robots.txt found');
    expect(t).not.toContain('Sitemap:');
  });
});
