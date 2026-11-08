/**
 * Whether a request comes from one of our own pages: its Origin is ours, or a browser sent none (or
 * `null`, as on a no-JS form post) and said the request is same-origin. A request with no Origin and
 * no Sec-Fetch-Site is not a browser's own-page request and is refused. This is the sign-in POST's
 * rule (CC-25), shared so the API routes apply the same one.
 */
export function isSameOrigin(req: Request, origin: string): boolean {
  const o = req.headers.get('origin');
  if (o === origin) return true;
  return (o === null || o === 'null') && req.headers.get('sec-fetch-site') === 'same-origin';
}
