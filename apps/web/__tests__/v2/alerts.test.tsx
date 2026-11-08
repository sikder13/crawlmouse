/**
 * Alerts against Final-Alerts: the visible text outside the rail equals the locked HTML with the
 * registered changes applied (lib/v2/copy/alerts.ts) and nothing else; one orange element, in the
 * header; every form posts to a known route; the switches are the Switch primitive.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlertsScreen } from '../../components/v2/screens/alerts/AlertsScreen';
import { alertsPreview } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import { ACCOUNT_ACTIONS } from '../../lib/v2/view/account-actions';
import { CC27B_ROUTES } from '../../lib/v2/view/settings';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const render = (name: 'home' | 'clean') =>
  renderToStaticMarkup(<AlertsScreen data={alertsPreview(name)} />);
const primaries = (html: string) => html.match(/data-v2-primary=""/g) ?? [];
const main = (html: string) => html.slice(html.indexOf('<main'));
const ROUTES = [...Object.values(ACCOUNT_ACTIONS), ...Object.values(CC27B_ROUTES)].map(
  (a) => new RegExp(`^${a.route.replace(/\[\w+\]/g, '[^/]+')}$`),
);

describe('Alerts against Final-Alerts', () => {
  const html = render('home');

  it('reads as the locked HTML outside the rail, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Alerts.dc.html')).rest, 'alerts'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('marks Alerts in the rail and has one orange element, in the page header', () => {
    expect(html).toMatch(/aria-current="page"[^>]*>Alerts[ <]/);
    expect(primaries(html)).toHaveLength(1);
    const header = main(html).slice(0, main(html).indexOf('</header>'));
    expect(primaries(header)).toHaveLength(1);
  });

  it('posts every form on the page to a route ACCOUNT_ACTIONS or CC27B_ROUTES names, never with a GET', () => {
    const forms = [...main(html).matchAll(/<form [^>]*>/g)].map(([tag]) => [
      tag.match(/ method="([^"]+)"/)?.[1],
      tag.match(/ action="([^"]+)"/)?.[1],
    ]);
    expect(forms).toHaveLength(6); // one switch per rule
    for (const [method, action] of forms) {
      expect(method).toBe('post');
      expect(
        ROUTES.some((r) => r.test(action!)),
        action,
      ).toBe(true);
    }
  });

  it('names each Open by the row it opens, for a screen reader (WCAG 2.4.4)', () => {
    expect(html).toMatch(
      />Open<span [^>]*data-v2-sr-only=""> crawler blocked: Claude-SearchBot, all pages/,
    );
  });
});

describe('Alerts, free', () => {
  it('has no orange element and nothing to open', () => {
    const html = render('clean');
    expect(primaries(html)).toHaveLength(0);
    expect(html).toContain('No alerts sent yet.');
  });
});
