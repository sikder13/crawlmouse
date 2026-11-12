/**
 * The URL a page is served at, as its server spells it. The engine names a page by its canonical
 * spelling (`canonicalizeUrl`), which drops a trailing slash; a site that redirects that spelling to
 * the slashed one answers a request for it with a redirect. A verify command and a step name the
 * address that answered: the row's `final_url` when it is the same page (it canonicalises to the
 * page's URL), and the page's URL otherwise.
 */
import { canonicalizeUrl } from '../../url-canonical.js';
import type { PacketFacts } from './types.js';

export function servedAt(facts: Pick<PacketFacts, 'pages'>, url: string): string {
  const final = facts.pages.get(url)?.final_url ?? null;
  if (final === null) return url;
  try {
    // An address with credentials in it is not one to print or request.
    const { username, password } = new URL(final);
    if (username !== '' || password !== '') return url;
    return canonicalizeUrl(final) === url ? final : url;
  } catch {
    return url;
  }
}

/**
 * The address a page's content was read at: where the request for it ended, when that answered 200.
 * A page whose request lands on another address (a homepage that redirects to `/en/`, a bare host to
 * `www`) is still that page to the crawl, which files what it read under the requested URL; a
 * command that reads the page requests the address that answered, since it follows no redirect.
 */
export function readAt(facts: Pick<PacketFacts, 'pages'>, url: string): string {
  const page = facts.pages.get(url);
  const final = page?.final_url ?? null;
  if (final === null || page?.status_code !== 200) return servedAt(facts, url);
  try {
    return sameSite(new URL(final), new URL(url)) ? final : servedAt(facts, url);
  } catch {
    return servedAt(facts, url);
  }
}

const bare = (host: string) => host.replace(/^www\./, '');

/**
 * `landed` is an address of the page's own site: over the page's scheme or https, with no
 * credentials, on the page's host give or take a leading `www.`, and on its port. A command a developer runs with a crawler's
 * user agent requests no other host, whatever a row holds.
 */
function sameSite(landed: URL, page: URL): boolean {
  // the page's own scheme, or https where the page was asked for over http: never down to http
  const web = landed.protocol === page.protocol || landed.protocol === 'https:';
  return (
    web &&
    landed.username === '' &&
    landed.password === '' &&
    bare(landed.hostname) === bare(page.hostname) &&
    landed.port === page.port
  );
}
