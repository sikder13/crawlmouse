import { describe, it, expect, vi } from 'vitest';
import { installDashboardRefresh, type VisibilityTarget } from './dashboard-refresh-logic';

function fakeTarget(visibilityState = 'visible') {
  let handler: (() => void) | null = null;
  const target: VisibilityTarget = {
    visibilityState,
    addEventListener: vi.fn((_type: string, h: () => void) => {
      handler = h;
    }),
    removeEventListener: vi.fn(),
  };
  return { target, fire: () => handler?.() };
}

describe('installDashboardRefresh', () => {
  it('refreshes once on mount (covers a stale cached dashboard after a new audit)', () => {
    const refresh = vi.fn();
    installDashboardRefresh(refresh, fakeTarget().target);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('registers exactly one listener (visibilitychange) — no double-fire from a focus listener', () => {
    const { target } = fakeTarget();
    installDashboardRefresh(vi.fn(), target);
    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    expect(target.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('refreshes when the tab becomes visible, but not while hidden', () => {
    const refresh = vi.fn();
    const t = fakeTarget('visible');
    installDashboardRefresh(refresh, t.target);
    refresh.mockClear();
    t.fire(); // visible → refresh
    expect(refresh).toHaveBeenCalledTimes(1);
    t.target.visibilityState = 'hidden';
    refresh.mockClear();
    t.fire(); // hidden → no refresh
    expect(refresh).not.toHaveBeenCalled();
  });

  it('removes the listener on cleanup so it does not leak', () => {
    const { target } = fakeTarget();
    const cleanup = installDashboardRefresh(vi.fn(), target);
    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
    expect(target.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
