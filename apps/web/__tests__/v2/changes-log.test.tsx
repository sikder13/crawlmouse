/**
 * The account Changes log as rendered (D3): no artboard, so no lock comparison. What is pinned
 * instead is that its table is CC-23's change table with the site first, that its filters are links
 * back to the page, and that it has nothing orange.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangesLogScreen } from '../../components/v2/screens/changes-log/ChangesLogScreen';
import { ChangeTable } from '../../components/v2/screens/segment/ChangesScreen';
import {
  CHANGES_LOG_PATH,
  changesLogPreview,
} from '../../app/(v2-preview)/v2-preview/_preview/screens';

const render = (q = {}) => renderToStaticMarkup(<ChangesLogScreen data={changesLogPreview(q)} />);

describe('the Changes log, rendered', () => {
  it('draws its rows with CC-23’s change table, the site as the first column', () => {
    const data = changesLogPreview();
    const table = renderToStaticMarkup(<ChangeTable label={data.tableLabel} rows={data.rows} />);
    expect(render()).toContain(table);
    expect(table).toMatch(
      /<thead[^>]*><tr><th scope="col"[^>]*>Site<\/th><th scope="col"[^>]*>When</,
    );
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
    expect(html).toContain('3 of 8 changes match: opened.');
  });

  it('says so in place of the table when nothing matches', () => {
    const html = render({ site: '50000000-0000-4000-8000-000000000004' });
    expect(html).toContain('No change matches these filters.');
    expect(html).not.toContain('<table');
  });
});
