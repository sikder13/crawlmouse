/**
 * A Retry-After value in milliseconds from `now`: delta-seconds or an HTTP date (RFC 9110 §10.2.3);
 * null for anything else.
 */
export function retryAfterMs(value: string | undefined, now: number): number | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (/^\d{1,10}$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
