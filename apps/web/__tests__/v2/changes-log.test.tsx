/**
 * The account Changes log as rendered (D3): no artboard, so no lock comparison. What is pinned
 * instead is that its five columns carry every value of a change row, that its filters are links
 * back to the page, and that it has nothing orange.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangesLogScreen } from '../../components/v2/screens/changes-log/ChangesLogScreen';
import { CHANGES_LOG_COPY } from '../../lib/v2/copy/changes-log';
import {
  CHANGES_LOG_PATH,
  changesLogPreview,
} from '../../app/(v2-preview)/v2-preview/_preview/screens';

const render = (q = {}) => renderToStaticMarkup(<ChangesLogScreen data={changesLogPreview(q)} />);

describe('the Changes log, rendered', () => {
  it('draws its rows in five columns, each row’s site, time, change, place, effect, cause and notice', () => {
    const data = changesLogPreview();
    const html = render();
    expect([...html.matchAll(/<th scope="col"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual([
      'Site and time',
      'What changed',
      'Where',
      'Effect',
      'Cause, and who was told',
    ]);
    const text = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    for (const r of data.rows) {
      for (const v of [r.site!, r.when, r.summary, r.where, r.effect, r.cause]) {
        expect(html).toContain(text(v).replace(/'/g, '&#x27;'));
      }
      if (r.pages !== null) expect(html).toContain(r.pages);
      if (r.subject) expect(html).toContain(`· ${text(r.subject)}`);
      for (const l of r.diff) {
        expect(html).toContain(`${l.sign} ${text(l.line).replace(/'/g, '&#x27;')}`);
      }
      if (r.told !== null) {
        expect(html).toContain(text(CHANGES_LOG_COPY.told(r.told)).replace(/'/g, '&#x27;'));
      }
    }
  });

  it('names each row by its first cell, and keeps a verdict on a crawler’s row', () => {
    const data = changesLogPreview();
    const html = render();
    expect([...html.matchAll(/<th scope="row"/g)]).toHaveLength(data.rows.length);
    const judged = data.rows.filter((r) => r.verdict !== null);
    expect(judged.length).toBeGreaterThan(0);
    for (const r of judged) expect(html).toContain(`data-v2-verdict="${r.verdict!.verdict}"`);
  });

  it('marks Changes in the rail and has no orange element', () => {
    const html = render();
    expect(html).toMatch(/aria-current="page"[^>]*>Changes[ <]/);
    expect(html).not.toContain('data-v2-primary');
  });

  it('links each filter back to the page, the one in force marked, and the page posts nothing', () => {
    const html = render({ kind: 'opened' });
    const current = [...html.matchAll(/<a href="([^"]*)"[^>]*aria-current="true"[^>]*>([^<]*)</g)];
    expect(current.map(([, href, label]) => [label, href])).toEqual([
      ['All sites', `${CHANGES_LOG_PATH}?kind=opened`],
      ['opened', `${CHANGES_LOG_PATH}?kind=opened`],
      ['Any time', `${CHANGES_LOG_PATH}?kind=opened`],
    ]);
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/<form /);
    expect(html).toContain('2 of 14 entries match: opened.');
  });

  it('says so in place of the table when nothing matches', () => {
    // drivepei.ca has one scheduled check that changed nothing (F-214) and no opened change.
    const html = render({ site: '50000000-0000-4000-8000-000000000004', kind: 'opened' });
    expect(html).toContain('No change matches these filters.');
    expect(html).not.toContain('<table');
  });

  it('says when a site filter names no site of this account, as a status', () => {
    const html = render({ site: 'e0000000-0000-4000-8000-000000000001' });
    expect(html).toContain('role="status"');
    expect(html).toContain('That site is not one you can see here');
    expect(html).not.toContain('e0000000-0000-4000-8000-000000000001');
    expect(render()).not.toContain('That site is not one you can see here');
  });
});
