/**
 * The dashboard against Final-Dashboard-Day0 and Final-Dashboard: the visible text outside the rail
 * equals the locked HTML with the registered changes applied (lib/v2/copy/dashboard.ts) and nothing
 * else, one orange element, the rail's links and counts, and every action stopped.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardScreen } from '../../components/v2/screens/dashboard/DashboardScreen';
import { dashboardPreview } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { ACCOUNT_ACTIONS } from '../../lib/v2/view/dashboard';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const render = (name: Parameters<typeof dashboardPreview>[0]) =>
  renderToStaticMarkup(<DashboardScreen data={dashboardPreview(name)} />);
const primaries = (html: string) => html.match(/data-v2-primary=""/g) ?? [];
/** The rail's link labels in order, counts removed, from a nav's markup. */
const railLabels = (nav: string) => [...nav.matchAll(/<a [^>]*>([^<]+)/g)].map((m) => m[1]!.trim());

describe.each([
  ['day0', 'Final-Dashboard-Day0.dc.html', 'dashboard-day0'],
  ['home', 'Final-Dashboard.dc.html', 'dashboard'],
] as const)('Dashboard %s against %s', (name, file, screen) => {
  const html = render(name);
  const lockedHtml = locked(file);

  it('reads as the locked HTML outside the rail, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(lockedHtml).rest, screen),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('has the rail’s links in the locked order, counted from the view model', () => {
    const [ours] = withoutShell(html).cut;
    const [theirs] = withoutShell(lockedHtml).cut;
    expect(railLabels(ours!)).toEqual(railLabels(theirs!));
    const data = dashboardPreview(name);
    for (const n of data.shell.nav) {
      if (n.count) expect(ours).toContain(`${n.label} <span`);
    }
    expect(ours).toMatch(/aria-current="page"[^>]*>Sites[ <]/);
  });

  it('has exactly one orange element, in the header (DESIGN-LOCK §7.5)', () => {
    expect(primaries(html)).toHaveLength(1);
    const header = html.slice(
      html.indexOf('<header', html.indexOf('<main')),
      html.indexOf('</header>', html.indexOf('<main')),
    );
    expect(primaries(header)).toHaveLength(1);
  });

  it('posts every form to a route CC-26b or CC-27 owns, never with a GET', () => {
    const routes = Object.values(ACCOUNT_ACTIONS).map(
      (a) => new RegExp(`^${a.route.replace(/\[\w+\]/g, '[^/]+')}$`),
    );
    const forms = [...html.matchAll(/<form [^>]*>/g)].map(([tag]) => [
      tag,
      tag.match(/ method="([^"]+)"/)?.[1],
      tag.match(/ action="([^"]+)"/)?.[1],
    ]);
    expect(forms.length).toBeGreaterThan(0);
    for (const [, method, action] of forms) {
      expect(method).toBe('post');
      expect(
        routes.some((r) => r.test(action!)),
        action,
      ).toBe(true);
    }
  });
});

describe.each(['clean', 'withheld'] as const)('Dashboard, %s', (name) => {
  const html = render(name);
  it('has exactly one orange element', () => {
    expect(primaries(html)).toHaveLength(1);
  });
});

describe('Dashboard, clean: the one-time trial offer (H5)', () => {
  it('offers 14 days of Pro as an ordinary button, the company’s ask and not the reader’s action', () => {
    const html = render('clean');
    expect(html).toContain('Start 14 days of Pro');
    const card = html.slice(html.indexOf('Start 14 days of Pro'));
    expect(card.slice(0, card.indexOf('</section>'))).not.toContain('data-v2-primary');
  });
});

describe('Dashboard, withheld: the sites the health mean leaves out (D5)', () => {
  it('says how many and why, beside the mean', () => {
    expect(render('withheld')).toContain('1 site excluded: AI readability withheld');
  });
});
