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
