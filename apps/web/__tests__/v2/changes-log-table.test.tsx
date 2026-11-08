/**
 * CC-23's change table, as the account Changes log reuses it (D3): unchanged for the segment page's
 * rows, and with the site as its first column when the rows name one.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangeTable } from '../../components/v2/screens/segment/ChangesScreen';
import { rowOf } from '../../lib/v2/view/segment/changes';
import { findCheck, fixture } from '../../lib/v2/fixtures';

const d = fixture('bad-site');
const change = d.changes.find((c) => c.id === '90000000-0000-4000-8000-000000000001')!;
const row = rowOf(change, findCheck(d, change.check_id), (ts) => ts);
const headers = (html: string) =>
  [...html.matchAll(/<th scope="col"[^>]*>([^<]*)</g)].map((m) => m[1]);

describe('ChangeTable', () => {
  it('without a site on its rows, draws the segment page’s columns and nothing more', () => {
    const html = renderToStaticMarkup(<ChangeTable label="Changes" rows={[row]} />);
    expect(headers(html)).toEqual([
      'When',
      'What changed',
      'Where',
      'Pages',
      'Effect',
      'Cause we found',
      'Who was told',
    ]);
  });

  it('with a site on its rows, draws it as the first column', () => {
    const html = renderToStaticMarkup(
      <ChangeTable label="Changes" rows={[{ ...row, site: 'example-outfitter.com' }]} />,
    );
    expect(headers(html)[0]).toBe('Site');
    expect(headers(html).slice(1)).toEqual(
      headers(renderToStaticMarkup(<ChangeTable label="Changes" rows={[row]} />)),
    );
    expect(html.indexOf('example-outfitter.com')).toBeLessThan(html.indexOf(row.when));
  });
});
