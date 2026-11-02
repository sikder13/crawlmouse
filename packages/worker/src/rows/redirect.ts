import type { RedirectChain } from '@crawlmouse/types/v2';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { bounded, CAPS } from './bounded.js';
import { storedUrl } from './evidence.js';

/**
 * A request's redirects as a row records them: each hop's `(from, status, location)` in order (at
 * most MAX_REDIRECTS + 1: politeFetch stops a chain at the hop after its fifth), and whether a
 * Location named a URL the chain had already requested.
 *
 * Loop detection compares URLs as requested, after URL parsing and without the fragment (which is
 * never sent): `/a` to `/a/` is a redirect, not a loop, so the engine's canonical spelling, which
 * would equate them, is not used here.
 */

/** A URL as a request sends it: parsed, without its fragment. */
function requested(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** The chain behind `f`; null when no response came back, so no redirect was seen. */
export function redirectChain(f: FetchOutcome): RedirectChain | null {
  if (f.status === null && f.hops.length === 0) return null;
  const seen = new Set<string>();
  let loop = false;
  const hops = f.hops.map((h) => {
    seen.add(requested(h.from));
    if (h.location !== '' && seen.has(requested(h.location))) loop = true;
    return {
      // A requested URL: within the URL cap, as politeFetch requests no longer one.
      from: bounded(h.from, CAPS.url)!,
      status: h.status,
      // None when politeFetch found it over the URL cap and kept none, or it names no web URL.
      location: h.location === '' ? null : storedUrl(h.location),
    };
  });
  return { hops, loop };
}
