import 'server-only';

/**
 * Resolve a safe base URL for post-redirect targets (Stripe success/cancel/return URLs).
 *
 * The `Origin` header is client-controllable, so honoring it blindly would let an attacker
 * forge it and redirect a just-paid user to an off-site phishing page. We only trust `Origin`
 * when it matches an allow-list; otherwise we fall back to the server-configured base URL.
 */
export function resolveOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const origin = req.headers.get('origin');
  const allowed = new Set([configured, 'http://localhost:3000'].filter(Boolean));
  return origin && allowed.has(origin) ? origin : configured;
}
