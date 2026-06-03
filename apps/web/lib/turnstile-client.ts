// Client-side Turnstile gating helper. Pure (relative imports only) so it can be unit-tested
// without the `@/` alias, and shared by every form that conditionally renders the widget.
//
// Turnstile is OFF in dev unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so local work stays
// frictionless. When the key is present every always-on form must hold submit until a token.

/** True iff a non-empty Turnstile site key is configured. */
export function turnstileEnabled(siteKey: string | undefined): boolean {
  return !!siteKey;
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
