import type { FunnelEvent } from './analytics-events';

// SPEC 04 §6/§13 — the share/attribution URL helpers. The share moment must produce a clean PUBLIC
// report link (`/r/<slug>`), NEVER the private capability URL (`/audit/<uuid>`), and every shared /
// embedded link carries a `?ref=` param so the landing can attribute the referral source (the K
// measurement, §13/§14). Pure + unit-tested; the slug + ref are encodeURIComponent'd (no param
// injection / open redirect).

/** Allowed referral sources (the share channels + copy/badge/report surfaces). Kept small + known. */
export type ShareRef = 'x' | 'linkedin' | 'whatsapp' | 'telegram' | 'facebook' | 'copy' | 'badge' | 'report';

/**
 * Build the public report URL to share. ALWAYS `/r/<slug>` (never the capability URL), with an optional
 * `?ref=` for attribution. `origin` is the site origin (a trailing slash is tolerated).
 */
export function reportShareUrl(origin: string, slug: string, ref?: ShareRef | null): string {
  const base = `${origin.replace(/\/+$/, '')}/r/${encodeURIComponent(slug)}`;
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}

/** Append `?ref=`/`&ref=` to an already-built URL (used when the caller already holds the /r/ URL). */
export function withRef(url: string, ref?: ShareRef | null): string {
  if (!ref) return url;
  return `${url}${url.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`;
}

/**
 * Read the referral source off a landing URL's query (`?ref=`). Returns a bounded, sanitized token
 * (lowercase, `[a-z0-9_-]`, <= 32 chars) or null — so an attacker-supplied ref never reaches analytics
 * or the DOM unbounded.
 */
export function readRef(search: string | URLSearchParams | null | undefined): string | null {
  if (!search) return null;
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
  const raw = params.get('ref');
  if (!raw) return null;
  const clean = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return clean.length > 0 ? clean : null;
}

/**
 * On a landing, read `?ref=` and (if present) fire `referral_landing{source}` — the K measurement
 * (§13/§14). Injected track keeps it pure/testable. Returns the sanitized source (or null).
 */
export function captureReferral(
  search: string | URLSearchParams | null | undefined,
  trackImpl: (event: FunnelEvent, props?: Record<string, unknown>) => void,
): string | null {
  const ref = readRef(search);
  if (ref) trackImpl('referral_landing', { source: ref });
  return ref;
}
