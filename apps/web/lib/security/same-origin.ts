/**
 * The request-origin rules the middleware applies to state changes (lib/security/route-policy.ts
 * says which rule a route takes). Edge-safe.
 */

/**
 * Strict: the request comes from one of our own pages. Its Origin is ours, or a browser sent none (or
 * `null`, as on a no-JS form post) and said the request is same-origin. A request with no Origin and
 * no Sec-Fetch-Site is not a browser's own-page request and is refused. This is the sign-in POST's
 * rule (CC-25), shared so the API routes apply the same one.
 */
export function isSameOrigin(req: Request, origin: string): boolean {
  const o = req.headers.get('origin');
  if (o === origin) return true;
  return (o === null || o === 'null') && req.headers.get('sec-fetch-site') === 'same-origin';
}

/**
 * Lenient: the request comes from another site's page. A browser says so with Sec-Fetch-Site, or
 * sends an Origin that is not ours (an opaque `null` included). A request with neither, such as a
 * script's, is not refused by this rule.
 */
export function isCrossSite(req: Request, origin: string): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return true;
  const o = req.headers.get('origin');
  return o !== null && o !== origin;
}

/**
 * The body is declared JSON: `application/json`, with or without parameters, in any case. Another
 * site's page can send a cross-origin POST without a CORS preflight only as `text/plain`, a form
 * encoding or multipart, so requiring this keeps such a POST out; the app never answers a preflight.
 */
export function isJsonBody(req: Request): boolean {
  const type = req.headers.get('content-type');
  return type !== null && type.split(';')[0]!.trim().toLowerCase() === 'application/json';
}
