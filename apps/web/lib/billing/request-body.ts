/**
 * The v2 billing routes' bodies and answers (CC-03 D6–D8). CC-27's screens post HTML forms and a
 * script posts JSON, so a route reads either; a form is answered with a redirect, JSON with JSON.
 * Refusals are JSON for both: showing them on a form's page is CC-27b's.
 */

export type BodyKind = 'form' | 'json';

export interface RequestBody {
  kind: BodyKind;
  /** A form's fields are strings; JSON's are whatever the object holds. */
  fields: Readonly<Record<string, unknown>>;
}

const FORM = 'application/x-www-form-urlencoded';
const JSON_TYPE = 'application/json';

function mediaType(req: Request): string | null {
  const header = req.headers.get('content-type');
  return header === null ? null : header.split(';')[0]!.trim().toLowerCase();
}

function formFields(text: string): RequestBody['fields'] | null {
  const pairs = [...new URLSearchParams(text)];
  // A field sent twice has no one value: refuse it rather than pick one.
  if (new Set(pairs.map(([k]) => k)).size !== pairs.length) return null;
  return Object.fromEntries(pairs);
}

function jsonFields(text: string): RequestBody['fields'] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RequestBody['fields'])
    : null;
}

/**
 * The body of a form post or a JSON post, or null for any other content type, a malformed body, a
 * JSON value that is not an object, or a form field sent twice. An empty body is no fields.
 */
export async function readBody(req: Request): Promise<RequestBody | null> {
  const type = mediaType(req);
  if (type !== FORM && type !== JSON_TYPE) return null;
  const text = await req.text();
  if (text === '') return { kind: type === FORM ? 'form' : 'json', fields: {} };
  const fields = type === FORM ? formFields(text) : jsonFields(text);
  return fields === null ? null : { kind: type === FORM ? 'form' : 'json', fields };
}

export function seeOther(url: string): Response {
  return new Response(null, { status: 303, headers: { location: url } });
}

/** A success that sends the caller to `url`: a 303 for a form, `{url}` for JSON. */
export function respond(kind: BodyKind, url: string): Response {
  return kind === 'form' ? seeOther(url) : Response.json({ url });
}

/** A refusal: the status, a stable `error`, and any detail after it. */
export function refuse(
  status: number,
  error: string,
  detail: Readonly<Record<string, string>> = {},
): Response {
  return Response.json({ error, ...detail }, { status });
}
