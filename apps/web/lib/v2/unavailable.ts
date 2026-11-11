/**
 * Why a v2 route that starts a check answers 503, as the `code` of its JSON body. One table for
 * the product: a route does not answer a 503 code of its own.
 */
export const UNAVAILABLE_CODES = {
  /** `CRAWL_PAUSED` is set (lib/crawl-pause.ts). */
  paused: 'paused',
  /** `V2_PIPELINE` is off: no function would run the check. */
  unavailable: 'unavailable',
  /** The `global:audits:day` ceiling refused, or could not be read (it fails closed). */
  capacity: 'capacity',
} as const;

export type UnavailableCode = (typeof UNAVAILABLE_CODES)[keyof typeof UNAVAILABLE_CODES];
