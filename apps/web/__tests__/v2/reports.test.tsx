/**
 * Reports against Final-Reports: the visible text outside the rail equals the locked HTML with the
 * registered changes applied (lib/v2/copy/reports.ts) and nothing else; one orange element; every
 * form posts to a known route; the site picker reloads the page with a GET.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportsScreen } from '../../components/v2/screens/reports/ReportsScreen';
import { REPORTS_PATHS, reportsPreview } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import { ACCOUNT_ACTIONS } from '../../lib/v2/view/account-actions';
import { CC27B_ROUTES } from '../../lib/v2/view/settings';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const render = (name: keyof typeof REPORTS_PATHS) =>
  renderToStaticMarkup(<ReportsScreen data={reportsPreview(name)} />);
const primaries = (html: string) => html.match(/data-v2-primary=""/g) ?? [];
const main = (html: string) => html.slice(html.indexOf('<main'));
const ROUTES = [...Object.values(ACCOUNT_ACTIONS), ...Object.values(CC27B_ROUTES)].map(
  (a) => new RegExp(`^${a.route.replace(/\[\w+\]/g, '[^/]+')}$`),
);

describe('Reports against Final-Reports', () => {
  const html = render('home');

  it('reads as the locked HTML outside the rail, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Reports.dc.html')).rest, 'reports'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('marks Reports in the rail and has one orange element: Make the PDF', () => {
    expect(html).toMatch(/aria-current="page"[^>]*>Reports[ <]/);
    expect(primaries(html)).toHaveLength(1);
    expect(html).toMatch(/data-v2-primary=""[^>]*>Make the PDF</);
  });

  it('reloads the card for another site with a GET to the page, and posts everything else', () => {
    const forms = [...main(html).matchAll(/<form [^>]*>/g)].map(([tag]) => [
      tag.match(/ method="([^"]+)"/)?.[1],
      tag.match(/ action="([^"]+)"/)?.[1],
    ]);
    expect(forms[0]).toEqual(['get', REPORTS_PATHS.home]);
    for (const [method, action] of forms.slice(1)) {
      expect(method).toBe('post');
      expect(
        ROUTES.some((r) => r.test(action!)),
        action,
      ).toBe(true);
    }
    expect(html).toMatch(/<select [^>]*name="site"/);
  });
});

describe('Reports, Agency', () => {
  it('lists the scheduled client reports and has one orange element', () => {
    const html = render('withheld');
    expect(primaries(html)).toHaveLength(1);
    expect(html).toContain('hello@harborlight.example');
  });
});
