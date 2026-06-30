// The Pro dashboard's per-site view-logic. The DATA shapes are the canonical v1.2 contract types from
// @crawlmouse/types, re-exported here so the dashboard components import them from one place. This
// module owns only the pure VIEW helpers SPEC 03 renders with.
export type {
  DashboardSite,
  DashboardSiteHistoryPoint,
  DashboardFixChecklistItem,
} from '@crawlmouse/types';

export type DeltaDirection = 'up' | 'down' | 'flat';

export function deltaDirection(scoreDelta: number): DeltaDirection {
  if (scoreDelta > 0) return 'up';
  if (scoreDelta < 0) return 'down';
  return 'flat';
}

export function deltaArrow(dir: DeltaDirection): string {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
}

/** SVG polyline points for a sparkline; scores 0..100 mapped into [w,h] with y inverted. */
export function sparklinePoints(scores: number[], w: number, h: number): string {
  const y = (s: number) => h - (Math.max(0, Math.min(100, s)) / 100) * h;
  if (scores.length === 0) return '';
  if (scores.length === 1) return `0,${y(scores[0] ?? 0).toFixed(1)}`;
  const step = w / (scores.length - 1);
  return scores.map((s, i) => `${(i * step).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
}

/** Open-loop pull: how many fixes remain. */
export function checklistRemaining(done: number, total: number): number {
  return Math.max(0, total - done);
}

/** Human time-span of a history ("over 25 days" / "over 3 months"); null when < 2 points. */
export function historySpanLabel(points: { ranAt: string }[]): string | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const days = Math.round((new Date(last.ranAt).getTime() - new Date(first.ranAt).getTime()) / 86_400_000);
  if (days < 1) return null;
  return days < 45 ? `over ${days} days` : `over ${Math.round(days / 30)} months`;
}

/**
 * Warm, "remembers you" score-movement copy — feeling-known beats a bare diff (retention). Takes the
 * MonitoringDelta.scoreDelta (number | null); the grade transition (C→B) is shown separately (the badge).
 */
export function deltaSentence(scoreDelta: number | null): string {
  const delta = scoreDelta ?? 0;
  // Engine scores are 2-decimal floats → round for display, and branch on the ROUNDED magnitude so a
  // sub-0.5 movement reads "Holding steady", never a self-contradictory "up 0 points".
  const n = Math.round(Math.abs(delta));
  if (n === 0) return 'Holding steady since your last visit';
  const pts = n === 1 ? 'point' : 'points';
  return delta > 0
    ? `Your fixes are working — up ${n} ${pts} since your last visit`
    : `Down ${n} ${pts} since your last visit — worth a look`;
}

/**
 * The re-audit endpoint returns ReauditResponse.newAuditId → the page navigates to /audit/<id>.
 * Pure extraction so the v1.2 field contract is unit-tested without a DOM.
 */
export function reauditTargetId(data: { newAuditId?: string | null }): string | null {
  return data.newAuditId ?? null;
}

export type ReauditOutcome =
  | { kind: 'navigate'; auditId: string }
  | { kind: 'captcha'; message: string }
  | { kind: 'error'; message: string };

const REAUDIT_CAPTCHA_MESSAGE = 'Quick check: please confirm you’re human, then try again.';
const REAUDIT_GENERIC_ERROR = 'Something went wrong';

/**
 * Decide what a re-audit POST response means, so ReauditButton SURFACES every non-200 instead of
 * silently no-opping. Mirrors the /start form (UrlForm): a 429 `captcha_required` → the captcha flow;
 * any other failure → its server message (or a generic fallback); a 200 missing newAuditId still
 * surfaces an error rather than vanishing. Pure so the contract is unit-tested without a DOM.
 */
export function reauditOutcome(ok: boolean, data: unknown): ReauditOutcome {
  const d = (data ?? {}) as { error?: string; newAuditId?: string | null };
  if (ok) {
    const id = reauditTargetId(d);
    return id ? { kind: 'navigate', auditId: id } : { kind: 'error', message: REAUDIT_GENERIC_ERROR };
  }
  if (d.error === 'captcha_required') return { kind: 'captcha', message: REAUDIT_CAPTCHA_MESSAGE };
  return { kind: 'error', message: d.error ?? REAUDIT_GENERIC_ERROR };
}

export type ReauditEffects =
  | { navigateTo: string }
  | { resetToken: true; showCaptcha: boolean; error: string };

/**
 * Map a reaudit outcome to the UI effects ReauditButton applies — extracted (pure) so the load-bearing
 * rule "reset the one-time Turnstile token on EVERY non-navigate outcome" (no repeat-captcha reuse
 * loop) is unit-tested without a DOM. navigate → go to the new audit; anything else → reset the token +
 * surface the inline error (and show the captcha widget only on a captcha challenge).
 */
export function reauditEffects(outcome: ReauditOutcome): ReauditEffects {
  if (outcome.kind === 'navigate') return { navigateTo: outcome.auditId };
  return { resetToken: true, showCaptcha: outcome.kind === 'captcha', error: outcome.message };
}

/**
 * Friendly "last audited" label: "just now" (< 1 min) / "N minutes|hours|days ago", FLOORED so it never
 * overstates elapsed time (90 min reads "1 hour ago", not "2"), falling back to an absolute UTC date
 * once 7 days or older. Relative time is timezone-independent, so this is correct server-rendered for
 * every visitor. Empty/unparseable → '' (the card renders no timestamp); a future time (clock skew)
 * reads "just now".
 */
export function relativeTime(iso: string, now: Date): string {
  if (!iso) return '';
  const then = new Date(iso);
  const ms = then.getTime();
  if (Number.isNaN(ms)) return '';
  const diff = now.getTime() - ms;
  if (diff <= 0) return 'just now';
  // Floor every bucket so the label never overstates; the < 60s guard keeps floor from yielding "0 minutes ago".
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(diff / 3_600_000);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(diff / 86_400_000);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Precise UTC timestamp for the hover title — the exact "when" behind the friendly relative label. */
export function absoluteTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}
