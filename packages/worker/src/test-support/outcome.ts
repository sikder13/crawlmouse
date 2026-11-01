import { MAX_BODY_BYTES, type FetchOutcome } from '../fetch/fetcher.js';
import { CRAWL, type Identity } from '../identities.js';

/** A FetchOutcome as a response of the given shape would produce it. */
export function outcome(over: Partial<FetchOutcome> & { identity?: Identity } = {}): FetchOutcome {
  const url = over.url ?? 'https://www.example.com/page';
  const body = over.body ?? '<html><body><p>hello world</p></body></html>';
  return {
    url,
    identity: CRAWL,
    startedAt: 0,
    ms: 10,
    status: 200,
    finalUrl: url,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    hops: [],
    redirectStop: null,
    body,
    bodyCut: false,
    bytes: Buffer.byteLength(body),
    maxBytes: MAX_BODY_BYTES,
    error: null,
    ...over,
  };
}
