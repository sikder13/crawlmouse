import { WAF_HEADER_ALLOWLIST } from './constants.js';

/**
 * §3 WAF/CDN disclosure — DISCLOSURE ONLY, never scored (§2). Matches homepage response headers against a
 * small, EXACT-header-name allowlist (Amendment §6: no prefix/wildcard patterns; `server` matches its exact
 * value, others match on presence). A false positive erodes trust, so the set stays high-precision.
 */
export function detectWaf(headers: Record<string, string | undefined>): { wafDetected: boolean; wafNote: string | null } {
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (typeof v === 'string') norm[k.toLowerCase()] = v;

  const vendors: string[] = [];
  for (const rule of WAF_HEADER_ALLOWLIST) {
    const val = norm[rule.header];
    if (val === undefined) continue;
    if (rule.equals !== undefined) {
      if (val.trim().toLowerCase() === rule.equals.toLowerCase() && !vendors.includes(rule.vendor)) vendors.push(rule.vendor);
    } else if (!vendors.includes(rule.vendor)) {
      vendors.push(rule.vendor);
    }
  }
  if (vendors.length === 0) return { wafDetected: false, wafNote: null };
  return {
    wafDetected: true,
    wafNote:
      `${vendors.join(', ')} edge/CDN detected. robots.txt allows these bots, but edge/CDN-level blocking ` +
      `cannot be detected from static analysis and may override the access shown here.`,
  };
}
