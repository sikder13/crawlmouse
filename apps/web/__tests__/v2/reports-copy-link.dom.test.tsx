// @vitest-environment jsdom
/**
 * F-125: the button beside a share link just made copies that link, and nothing else. The view is
 * the real one over the fixture; the clipboard is a fake.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { LiveActions } from '../../components/v2/screens/account/LiveActions';
import { ReportsScreen } from '../../components/v2/screens/reports/ReportsScreen';
import { fixture } from '../../lib/v2/fixtures';
import { reportsView } from '../../lib/v2/view/reports';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bad = fixture('bad-site');
const url = 'https://crawlmouse.com/s/kJ8sT2mQ9x_p4VnR7bWc-A';
const writeText = vi.fn(async (_: string) => undefined);

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe('the share link just made', () => {
  it('has a button that copies the link itself', async () => {
    // The CSV is the fixture's report with a link that works, as a link just made has.
    const csv = bad.reports.find((r) => r.format === 'csv')!;
    const data = reportsView(bad, ACCOUNT_VIEWERS.home(), {}, '/reports', {
      madeLink: { reportId: csv.id, url },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <LiveActions>
          <ReportsScreen data={data} />
        </LiveActions>,
      ),
    );
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Copy link')!;
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledWith(url);
  });
});
