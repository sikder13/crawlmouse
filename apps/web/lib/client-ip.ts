/**
 * Best-effort client IP for rate limiting.
 *
 * On Vercel the platform rewrites the client-supplied `x-forwarded-for` at the edge
 * specifically to prevent IP spoofing, so the left-most entry is the real peer and
 * `x-real-ip` is the same value (https://vercel.com/docs/headers/request-headers). We
 * intentionally do NOT trust an arbitrary forwarded chain beyond that.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}
