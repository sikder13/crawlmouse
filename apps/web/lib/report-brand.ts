import type { WhiteLabelConfig } from '@crawlmouse/types';

// SPEC 04 §5 — the branding surface shared by the report page, print/PDF, and OG card. Centralised so
// the "Crawlmouse vs. owner brand" decision + the logo URL construction can never drift between them.

/** The service-role bucket that holds validated white-label logos (public read via our CDN path). */
export const LOGO_BUCKET = 'report-logos';

/**
 * The brand name to render — the white-label brand when a claimed Pro owner set one, else `null`
 * (meaning: show the Crawlmouse wordmark, the viral default). A blank/whitespace name is treated as no
 * brand so an empty toggle never blanks the report.
 */
export function whiteLabelBrandName(wl: WhiteLabelConfig | null | undefined): string | null {
  const name = wl?.brandName?.trim();
  return name ? name : null;
}

/**
 * Public CDN URL for a validated logo in the report-logos bucket. `null` when there is no logo or the
 * Supabase base URL is unconfigured (so the caller falls back to the text-only brand).
 */
export function logoPublicUrl(logoPath: string | null | undefined): string | null {
  if (!logoPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${LOGO_BUCKET}/${logoPath}`;
}
