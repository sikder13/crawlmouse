// @vitest-environment jsdom
/** The shared report's view beacon (CC-29 Q14): one POST to the view route per mount. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportViewBeacon, reportViewPath } from './ReportViewBeacon';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('ReportViewBeacon', () => {
  it('posts one view of its report when it mounts, and none when it renders again', () => {
    act(() => root.render(<ReportViewBeacon slug="abc123" />));
    act(() => root.render(<ReportViewBeacon slug="abc123" />));
    expect(fetchMock.mock.calls).toEqual([
      ['/api/reports/abc123/view', { method: 'POST', keepalive: true }],
    ]);
    expect(host.innerHTML).toBe('');
  });

  it('a failed post is dropped, not thrown', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    act(() => root.render(<ReportViewBeacon slug="abc123" />));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('puts the slug in the path as one segment', () => {
    expect(reportViewPath('a b/c')).toBe('/api/reports/a%20b%2Fc/view');
  });
});
