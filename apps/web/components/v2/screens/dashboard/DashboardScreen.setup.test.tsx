/**
 * F-304 (D-42): the set-up card's "Done" column shows each row's state on screen. A done row has
 * the green "done" pill; a row still to do has a neutral "not done" pill, which a sighted reader
 * sees too, not text for screen readers only.
 */
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardScreen } from './DashboardScreen';
import { dashboardPreview } from '../../../../app/(v2-preview)/v2-preview/_preview/accounts';

type Data = Parameters<typeof DashboardScreen>[0]['data'];

function setupRows(): HTMLTableRowElement[] {
  const base = dashboardPreview('home');
  const data: Data = {
    ...base,
    setup: {
      title: 'Set-up',
      items: [
        { key: 'slack', label: 'Slack alerts connected', done: true, action: null },
        { key: 'staging', label: 'Add a staging URL', done: false, action: null },
      ],
      schedule: null,
      foot: null,
    },
  };
  const doc = new JSDOM(renderToStaticMarkup(<DashboardScreen data={data} />)).window.document;
  const table = doc.querySelector('table[aria-label="Set-up"]');
  expect(table).not.toBeNull();
  return [...table!.querySelectorAll('tbody tr')] as HTMLTableRowElement[];
}

describe('the set-up card’s Done column', () => {
  it('shows "not done" on screen, in a neutral pill, for a row still to do', () => {
    const undone = setupRows().find((r) => r.textContent?.includes('Add a staging URL'))!;
    const cell = undone.cells[0]!;
    const pill = cell.querySelector('[data-v2-pill]');
    expect(pill?.getAttribute('data-v2-pill')).toBe('neutral');
    expect(pill?.textContent).toBe('not done');
    // Seen, not only heard: nothing in the cell is the visually hidden class.
    expect(cell.querySelector('[data-v2-sr-only]')).toBeNull();
    expect(cell.textContent).toBe('not done');
  });

  it('keeps the "done" pill for a done row', () => {
    const done = setupRows().find((r) => r.textContent?.includes('Slack alerts connected'))!;
    const pill = done.cells[0]!.querySelector('[data-v2-pill]');
    expect(pill?.getAttribute('data-v2-pill')).toBe('ok');
    expect(pill?.textContent).toBe('OK: done');
  });
});
