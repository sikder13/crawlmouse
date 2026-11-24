/**
 * A Retry-After value in milliseconds from `now`: delta-seconds or an IMF-fixdate HTTP date (RFC 9110 §10.2.3);
 * null for anything else.
 */
export function retryAfterMs(value: string | undefined, now: number): number | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (/^\d{1,10}$/.test(v)) return Number(v) * 1000;
  // An HTTP date (IMF-fixdate, as RFC 9110 has servers send). Date.parse alone also reads strings
  // such as "1.5" or "-1" as dates, which would remove the back-off.
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(v)) return null;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
