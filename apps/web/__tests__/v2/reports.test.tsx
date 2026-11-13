/**
 * Reports against Final-Reports: the visible text outside the rail equals the locked HTML with the
 * registered changes applied (lib/v2/copy/reports.ts) and nothing else; one orange element; every
 * form posts to a known route; the site picker reloads the page with a GET.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('Reports, a share link just made', () => {
  const URL = 'https://crawlmouse.com/s/kJ8sT2mQ9x_p4VnR7bWc-A';
  const data = reportsPreview('home');
  const withLink = {
    ...data,
    made: {
      ...data.made,
      rows: data.made.rows.map((r, i) =>
        i === 0
          ? { ...r, madeLink: { label: 'The link, shown here for a short while:', url: URL } }
          : r,
      ),
    },
  };
  const html = renderToStaticMarkup(<ReportsScreen data={withLink} />);

  it('is drawn once, in an element session recording masks and blocks', () => {
    expect(html.split(URL)).toHaveLength(2);
    const holder = new RegExp(`<([a-z]+)([^>]*)>${URL.replace(/[.]/g, '\\.')}</\\1>`).exec(html)!;
    expect(holder[1]).toBe('code');
    // The recorder's own class for an element it leaves out of a recording and of autocapture.
    expect(holder[2]).toMatch(/ class="ph-no-capture"/);
    // The attribute this project's recorder is told to mask.
    expect(holder[2]).toContain(' data-ph-mask=""');
    const config = readFileSync(join(process.cwd(), 'instrumentation-client.ts'), 'utf8');
    expect(config).toContain("maskTextSelector: '[data-ph-mask]'");
  });

  it('a row with no link just made carries neither mark', () => {
    const plain = renderToStaticMarkup(<ReportsScreen data={data} />);
    expect(plain).not.toContain('data-ph-mask');
    expect(plain).not.toContain('ph-no-capture');
  });
});

describe('Reports, Agency', () => {
  it('lists the scheduled client reports and has one orange element', () => {
    const html = render('withheld');
    expect(primaries(html)).toHaveLength(1);
    expect(html).toContain('hello@harborlight.example');
  });

  it('gives each row of Reports and of Scheduled reports a header, its first cell', () => {
    const html = render('withheld');
    const data = reportsPreview('withheld');
    for (const [label, rows] of [
      ['Reports', data.made.rows.map((r) => r.made)],
      ['Scheduled reports', data.scheduled.rows.map((r) => r.when)],
    ] as const) {
      const table = new RegExp(`<table[^>]*aria-label="${label}"[\\s\\S]*?</table>`).exec(html)![0];
      const heads = [...table.matchAll(/<th scope="row"[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
        m[1]!.replace(/<[^>]+>/g, ''),
      );
      expect(rows.length, label).toBeGreaterThan(0);
      expect(heads, label).toEqual(rows);
    }
  });
});
