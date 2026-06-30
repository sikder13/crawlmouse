// Minimal structural shape of the document DashboardAutoRefresh listens on — declared so the wiring
// is unit-testable without a DOM.
export interface VisibilityTarget {
  visibilityState: string;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

/**
 * Install the dashboard's freshness wiring and return the cleanup. Refreshes once NOW (covers a cached
 * back-navigation right after running a new audit — the reported staleness), and again whenever the tab
 * becomes visible (covers a long-lived dashboard tab). Listens to 'visibilitychange' ONLY — not also
 * 'focus' — so a single tab-return triggers exactly one refresh. Pure → the mount refresh, the
 * visible-only guard, and listener cleanup are unit-tested without a DOM.
 */
export function installDashboardRefresh(refresh: () => void, target: VisibilityTarget): () => void {
  refresh();
  const onVisible = () => {
    if (target.visibilityState === 'visible') refresh();
  };
  target.addEventListener('visibilitychange', onVisible);
  return () => target.removeEventListener('visibilitychange', onVisible);
}
