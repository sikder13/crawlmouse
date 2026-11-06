/**
 * What Sentry must never receive from the sign-in path (SECURITY-DESIGN §9.2): the link's token, a
 * Keep's claim target (`post_login_next`, whose check id is a claim capability), the ledger's device
 * signal, and the session.
 *
 * Three layers, each tested in __tests__/v2/account-door-sentry.test.ts, the last two through the
 * SDK's own event pipeline:
 * - spans: the door's cookie names contain `auth`, which Sentry's span-header filter replaces with
 *   "[Filtered]";
 * - events: `sentryServerOptions` turns off the request-data integration's cookies, which removes
 *   both `request.cookies` and the raw `Cookie` header from every event, and its request bodies (a
 *   sign-in POST's body holds an email address; the Edge runtime sends request data only because
 *   this integration is named). The test pins the cookies; its plain-http harness captures no
 *   body even with every layer off, so it cannot pin the body setting;
 * - `scrubDoorSecrets`, run on every event and transaction: walks the event's own plain objects
 *   and arrays (never the SDK's `sdkProcessingMetadata`, which holds the live scope and client);
 *   drops `cookie`, `cookies`, `set-cookie`, `token_hash`, `post_login_next` and span cookie-header
 *   keys at any depth; and replaces a `token_hash` or `code` query value (URL-encoded or not), a
 *   `post_login_next=` value and a PostgREST `=eq.` filter value wherever a string holds one.
 */

/**
 * A `token_hash` or `code` parameter, after the start of a string, `?`, `&` or `;`, or their
 * URL-encoded forms; its value runs to the next delimiter, an encoded `&` included.
 */
const SECRET_QUERY =
  /((?:^|[?&;]|%3F|%26)(?:token_hash|code)(?:=|%3D))[^&#;\s"%]*(?:%(?!26)[0-9a-f]{2}[^&#;\s"%]*)*/gi;
/**
 * Keys whose whole value goes: cookies in any shape (the parsed map, the raw header, a span's
 * `http.request.header.cookie.<name>` attribute), the return target, and the token as a key.
 */
const DROPPED_KEY =
  /^(?:cookies?|set-cookie|token_hash)$|^http\.(?:request|response)\.header\.(?:cookie|set_cookie)\b|post_login_next/i;
/** A `post_login_next=` pair inside a string (a cookie header, a log line): its value goes. */
const NEXT_IN_STRING = /(post_login_next=)[^;&\s"]*/gi;
/**
 * A PostgREST filter value in a request URL or query (`id=eq.<check id>`, an outgoing request's
 * breadcrumb): the ids the door looks up by are capabilities.
 */
const POSTGREST_FILTER = /(=(?:eq|neq|in|is)\.)[^&#\s"]*/gi;
/**
 * The SDK's own processing state, which holds the live scope and client: never part of what is
 * sent, and not ours to walk (a getter-only property on it throws when assigned).
 */
const SDK_STATE = 'sdkProcessingMetadata';

/** Only the event's own data: plain objects and arrays. A class instance is the SDK's, left alone. */
function isPlainRecord(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function scrub(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return value
      .replace(SECRET_QUERY, '$1[Filtered]')
      .replace(NEXT_IN_STRING, '$1[Filtered]')
      .replace(POSTGREST_FILTER, '$1[Filtered]');
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (!Array.isArray(value) && !isPlainRecord(value)) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrub(value[i], seen);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === SDK_STATE) continue;
    if (DROPPED_KEY.test(key)) {
      delete record[key];
      continue;
    }
    record[key] = scrub(record[key], seen);
  }
  return value;
}

/** For `beforeSend` and `beforeSendTransaction`: the same event, with the door's secrets removed. */
export function scrubDoorSecrets<T>(event: T): T {
  return scrub(event, new WeakSet()) as T;
}

/**
 * The server SDK's options that keep those secrets out, for `Sentry.init` in sentry.server.config.ts
 * and for the test that drives the SDK with them. `requestDataIntegration` is passed in so this
 * module does not load the SDK.
 */
export function sentryServerOptions<I>(
  requestDataIntegration: (options: { include: { cookies: false; data: false } }) => I,
) {
  return {
    integrations: [requestDataIntegration({ include: { cookies: false, data: false } })],
    beforeSend: <E>(event: E) => scrubDoorSecrets(event),
    beforeSendTransaction: <E>(event: E) => scrubDoorSecrets(event),
  };
}
