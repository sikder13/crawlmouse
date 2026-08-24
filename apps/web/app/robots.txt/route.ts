import { robotsTxt } from '@/lib/robots-txt';

/**
 * /robots.txt as a route handler rather than Next's `robots.ts` metadata convention.
 *
 * The metadata API returns a typed object and serialises it itself, which leaves no way to emit a
 * comment line — and the Content Signals declaration is a comment by specification. Rather than
 * ship the signals somewhere a crawler would not look for them, the file is written out in full.
 *
 * The trade is that the rules are now assembled by hand, so `lib/robots-txt.test.ts` pins the
 * output the metadata route used to produce — the wildcard group, its four disallows, the host and
 * the sitemap line — character for character. This route adds to that document and changes nothing
 * already in it.
 *
 * `force-static` keeps it prerendered at build time, which is what the metadata route did; nothing
 * here reads the request.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(robotsTxt(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
