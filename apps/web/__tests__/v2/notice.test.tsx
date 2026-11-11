/** A refused form's notice on the live screens (CC-26b follow-up): one line, or nothing. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardScreen } from '../../components/v2/screens/dashboard/DashboardScreen';
import { FirstCheckScreen } from '../../components/v2/screens/site/FirstCheckScreen';
import { SiteScreen } from '../../components/v2/screens/site/SiteScreen';
import {
  dashboardPreview,
  firstCheckPreview,
  shellPreview,
  sitePreview,
} from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { noticeLine } from '../../lib/v2/copy/notices';

const notice = noticeLine({ notice: 'capped', next: '2026-11-10T13:30:00.000Z' }, 'UTC');
const count = (html: string) => (html.match(/data-v2-notice=/g) ?? []).length;

describe('the notice line', () => {
  it('each screen shows it once, as a status, with its code and text', () => {
    for (const html of [
      renderToStaticMarkup(<DashboardScreen data={dashboardPreview('home')} notice={notice} />),
      renderToStaticMarkup(
        <SiteScreen data={sitePreview('home')} shell={shellPreview('home')} notice={notice} />,
      ),
      renderToStaticMarkup(<FirstCheckScreen data={firstCheckPreview()} notice={notice} />),
    ]) {
      expect(count(html)).toBe(1);
      expect(html).toMatch(/<p[^>]*role="status"[^>]*data-v2-notice="capped"/);
      expect(html).toContain('The next can run Tue 13:30.');
    }
  });

  it('with no notice, or an unknown one, nothing is drawn', () => {
    const unknown = noticeLine({ notice: 'nonsense' }, 'UTC');
    expect(unknown).toBeNull();
    for (const n of [undefined, unknown]) {
      expect(
        count(renderToStaticMarkup(<DashboardScreen data={dashboardPreview('home')} notice={n} />)),
      ).toBe(0);
      expect(
        count(
          renderToStaticMarkup(
            <SiteScreen data={sitePreview('home')} shell={shellPreview('home')} notice={n} />,
          ),
        ),
      ).toBe(0);
    }
  });
});

describe('the screens for a sign-in with no account, or several', () => {
  it('name the footer’s support address where they point to support', async () => {
    const { AccountStateScreen } =
      await import('../../components/v2/screens/account/AccountStateScreen');
    const { SUPPORT_EMAIL } = await import('../../components/v2/footer-links');
    const ambiguous = renderToStaticMarkup(<AccountStateScreen state="ambiguous" />);
    expect(ambiguous).toContain(`write to ${SUPPORT_EMAIL}.`);
    for (const state of ['ambiguous', 'no_account'] as const)
      expect(renderToStaticMarkup(<AccountStateScreen state={state} />)).not.toMatch(
        /write to support(?!@)/,
      );
  });
});
