import type { PanelGroup } from './types.js';

export const FULL_TARGETS: Record<PanelGroup, number> = { cf_ads: 400, cf_no_ads: 100, ads_no_cf: 100 };
export const FULL_TOTAL = Object.values(FULL_TARGETS).reduce((a, b) => a + b, 0);

/**
 * `--limit N` is a HARD cap on the panel size, not a hint: rounding each stratum independently
 * overshoots (15 became 10+3+3=16), and a rehearsal that quietly builds a different panel than the
 * one asked for is the wrong thing to rehearse. Strata are scaled, floored at 1, then the largest is
 * decremented until the total fits.
 *
 * Lives in its own module rather than in build-panel.ts because that file is a CLI entry: it runs on
 * import, so a test that imported it to reach this function would launch a panel build.
 */
export function scaledTargets(limit: number | undefined): Record<PanelGroup, number> {
  if (limit === undefined || limit >= FULL_TOTAL) return { ...FULL_TARGETS };
  const scale = limit / FULL_TOTAL;
  const t: Record<PanelGroup, number> = {
    cf_ads: Math.max(1, Math.round(FULL_TARGETS.cf_ads * scale)),
    cf_no_ads: Math.max(1, Math.round(FULL_TARGETS.cf_no_ads * scale)),
    ads_no_cf: Math.max(1, Math.round(FULL_TARGETS.ads_no_cf * scale)),
  };
  const keys = Object.keys(t) as PanelGroup[];
  const total = (): number => keys.reduce((a, k) => a + t[k], 0);
  while (total() > Math.max(keys.length, limit)) {
    const biggest = keys.reduce((a, b) => (t[a] >= t[b] ? a : b));
    if (t[biggest] <= 1) break;
    t[biggest] -= 1;
  }
  return t;
}
