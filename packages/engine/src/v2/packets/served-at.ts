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
    return canonicalizeUrl(final) === url ? final : url;
  } catch {
    return url;
  }
}
