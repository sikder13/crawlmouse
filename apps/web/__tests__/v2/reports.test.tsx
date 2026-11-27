/**
 * Reports against Final-Reports: the visible text outside the rail equals the locked HTML with the
 * registered changes applied (lib/v2/copy/reports.ts) and nothing else; one orange element; every
 * form posts to a known route; the site picker reloads the page with a GET.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportsScreen } from '../../components/v2/screens/reports/ReportsScreen';
import { REPORTS_PATHS, reportsPreview } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import { ACCOUNT_ACTIONS } from '../../lib/v2/view/account-actions';
import { CC27B_ROUTES } from '../../lib/v2/view/settings';
import { reportsView } from '../../lib/v2/view/reports';
import { fixture } from '../../lib/v2/fixtures';
import { ACCOUNT_VIEWERS } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
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
          ? { ...r, madeLink: { label: 'The link, shown here for two minutes:', url: URL } }
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
      // The scroll region around the table carries the class whose rule takes the line from under
      // the last row's header cell (AccountScreen.module.css, held in agency.test.tsx).
      const region = html
        .slice(0, html.indexOf(table))
        .match(/<[a-z]+ [^>]*>/g)!
        .at(-1)!;
      expect(region, label).toMatch(/class="[^"]*rowHeaded[^"]*"/);
    }
  });
});

/**
 * QA's re-walk (25 Nov): Reports showed 19 times with no zone (D-17's rule: every time on an account
 * page names its zone). Read from each rendered Reports preview, not listed: every clock time on the
 * page, rail and main alike, is followed by a zone.
 */
/** Each clock time in a rendered page, rail and main alike, and those with no zone after them. */
function unzonedTimes(html: string): { times: number; unzoned: string[]; text: string } {
  const doc = new JSDOM(html).window.document;
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ');
  const found = [...text.matchAll(/(?<!\d)\d{2}:\d{2}(?!\d)(.{0,5})/g)];
  const unzoned = found
    .filter((m) => !/^ ?(?:[A-Z]{1,4}T|UTC|GMT[+-]\d)/.test(m[1]!))
    .map((m) => m[0]);
  return { times: found.length, unzoned, text };
}

describe('Reports, every time names its zone (D-17)', () => {
  for (const name of Object.keys(REPORTS_PATHS) as (keyof typeof REPORTS_PATHS)[]) {
    it(name, () => {
      const { times, unzoned } = unzonedTimes(render(name));
      expect(times, 'the page shows times').toBeGreaterThan(0);
      expect(unzoned).toEqual([]);
    });
  }

  // QA's B1 on #218: the sweep above reads each preview at its fixture's moment, so it never reached a
  // trial's last day, when the rail's trial card shows a time ("ends today at"). bad-site's trial ends
  // 8 Nov 02:41Z, Sat 7 Nov 21:41 EST in its zone; this reads Reports at 10:00 EST that day.
  // F-336's last string: a compare of two checks of one day shows each check's time (D-28), and
  // each names its zone. bad-site's compare covers checks 1 and 5; the second is moved to 25 Oct
  // 03:30Z, Sat 24 Oct 23:30 EDT, the day of the first (22:34 EDT).
  it('home, with a compare of two checks of one day', () => {
    const sameDay = structuredClone(fixture('bad-site'));
    sameDay.checks.find((c) => c.id === 'c0000000-0000-4000-8000-000000000005')!.finished_at =
      '2026-10-25T03:30:00Z';
    const html = renderToStaticMarkup(
      <ReportsScreen data={reportsView(sameDay, ACCOUNT_VIEWERS.home(), {}, REPORTS_PATHS.home)} />,
    );
    const { unzoned, text } = unzonedTimes(html);
    expect(text).toContain('Sat 24 Oct 22:34 EDT vs Sat 24 Oct 23:30 EDT');
    expect(unzoned).toEqual([]);
  });

  it('home, on the trial’s last day, when the rail’s trial card shows a time', () => {
    const bad = fixture('bad-site');
    expect(bad.accounts[0]!.trial_ends_at).toBe('2026-11-08T02:41:00Z');
    const lastDay = { ...ACCOUNT_VIEWERS.home(), now: '2026-11-07T15:00:00.000Z' };
    const html = renderToStaticMarkup(
      <ReportsScreen data={reportsView(bad, lastDay, {}, REPORTS_PATHS.home)} />,
    );
    const { unzoned, text } = unzonedTimes(html);
    expect(text).toContain('ends today at 21:41 EST');
    expect(unzoned).toEqual([]);
  });
});
