/**
 * Absolute site origin for user-facing share URLs (embed iframe src, public-report
 * links, social-card footers). Derived from NEXT_PUBLIC_BASE_URL so preview/staging
 * and the eventual custom domain all work, instead of the prod host being hardcoded
 * in five places. Falls back to the prod origin when the env var is unset.
 *
 * Safe on both server and client (NEXT_PUBLIC_* is inlined at build time).
 */
const DEFAULT_ORIGIN = 'https://crawlmouse.com';

export function siteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_ORIGIN;
  return base.replace(/\/+$/, '');
}

/** Absolute URL for a path on the site, e.g. siteUrl('/r/abc') -> 'https://.../r/abc'. */
export function siteUrl(path = ''): string {
  if (!path) return siteOrigin();
  return `${siteOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Bare host (no scheme) for display, e.g. footers: 'crawlmouse.com'. */
export function siteHost(): string {
  try {
    return new URL(siteOrigin()).host;
  } catch {
    return new URL(DEFAULT_ORIGIN).host;
  }
}
