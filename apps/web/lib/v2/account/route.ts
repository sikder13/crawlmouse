/**
 * What the CC-26b routes share. Each route still calls `getUser()` and its membership `rpc()`
 * itself, in its own file, ahead of any service-role client: the route registry's mechanism check
 * (`__tests__/security/route-mechanism.ts`) reads those calls from the route's source, so they
 * cannot move in here.
 *
 * Bodies and successful answers are the billing routes' (`lib/billing/request-body.ts`): a form is
 * answered with a 303, JSON with JSON. A refusal is `{ code, …detail }`, the shape of the v2 door's
 * and the public check routes' refusals.
 */
import type { TierGates } from '../../entitlement-v2';
import type { RequestBody } from '../../billing/request-body';

export { readBody, respond, type RequestBody } from '../../billing/request-body';

/** A refusal: the status, a stable `code`, and any detail after it. */
export function refuse(
  status: number,
  code: string,
  detail: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json({ ...detail, code }, { status, headers });
}

/** A route's answer when its flag is off, and for a row that is not the caller's. */
export const notFound = (): Response => refuse(404, 'not_found');

/** A refusal for a gate the caller's tier does not open, named as `GATES` names it. */
export const paywall = (gate: keyof TierGates): Response =>
  refuse(402, 'upgrade_required', { gate });

/**
 * Why a check cannot start now, the product's one table of 503 codes (owner ruling R28; CC-22b
 * exports the same table and this one is replaced by it at the merge).
 */
export const SERVICE_CODES = {
  /** `CRAWL_PAUSED` is set. */
  paused: 'paused',
  /** `V2_PIPELINE` is off, so a queued check would never run. */
  unavailable: 'unavailable',
  /** The day's `global:audits:day` ceiling refused the start. */
  capacity: 'capacity',
} as const;

export const serviceRefusal = (code: keyof typeof SERVICE_CODES): Response =>
  refuse(503, SERVICE_CODES[code]);

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A path id as the tables key their rows: a lowercase UUID. */
export const isId = (v: string): boolean => ID.test(v);

/**
 * The method a request means: a form posts PATCH and DELETE as POST with `_method`
 * (`view/account-actions.ts`, `action()`), JSON uses the request's own method. The `_method` field
 * is not a field of the action, so it is left out of what is returned.
 */
export function meantMethod(
  req: Request,
  body: RequestBody,
): { method: string; fields: RequestBody['fields'] } {
  if (req.method !== 'POST' || body.kind !== 'form' || !('_method' in body.fields)) {
    return { method: req.method, fields: body.fields };
  }
  const { _method, ...fields } = body.fields;
  return { method: String(_method).toUpperCase(), fields };
}
