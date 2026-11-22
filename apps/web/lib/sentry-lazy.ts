/**
 * The browser's Sentry, loaded after the page instead of with it (F-045: its chunk was the largest
 * single cost on a phone, on every page). `instrumentation-client.ts` configures it at start; the SDK
 * is fetched when the browser is idle, or at once on the first error. An error thrown before it has
 * loaded is held here (at most `HELD_ERRORS_MAX`) and reported once it has, through the same
 * `beforeSend` scrubbing as any other.
 *
 * With no DSN (local, CI builds) nothing is fetched.
 */
import type * as SentryModule from '@sentry/nextjs';

type Sentry = typeof SentryModule;
type SentryOptions = NonNullable<Parameters<Sentry['init']>[0]>;

/** The most errors held while the SDK loads; a page throwing in a loop does not grow this. */
export const HELD_ERRORS_MAX = 10;
/** How long the browser may stay busy before the SDK is fetched anyway. */
export const IDLE_TIMEOUT_MS = 5000;

let options: SentryOptions | null = null;
let loading: Promise<Sentry> | null = null;
let loaded: Sentry | null = null;
/** The event id each error object was reported under. */
const reported = new WeakMap<object, string>();

export function configureSentry(next: SentryOptions): void {
  options = next;
}

/** The SDK, initialised once with the configured options; null when there is no DSN. */
export function loadSentry(): Promise<Sentry> | null {
  if (!options?.dsn) return null;
  const configured = options;
  loading ??= import(
    /* webpackExports: ["init", "captureException", "captureRouterTransitionStart"] */
    '@sentry/nextjs'
  ).then((sdk) => {
    sdk.init(configured);
    loaded = sdk;
    return sdk;
  });
  return loading;
}

/**
 * Reports an error, loading the SDK if it has not loaded, and answers with the event's id. Null when
 * there is no DSN or the SDK could not load: there is then no event to refer to.
 */
export async function reportToSentry(error: unknown): Promise<string | null> {
  try {
    const sdk = await loadSentry();
    if (!sdk) return null;
    // The SDK drops a repeat of one error object but still mints an id for it: an id no event has.
    const known = typeof error === 'object' && error !== null ? reported.get(error) : undefined;
    if (known !== undefined) return known;
    const id = sdk.captureException(error);
    if (typeof error === 'object' && error !== null) reported.set(error, id);
    return id;
  } catch {
    return null;
  }
}

/** Next's router hook: a navigation before the SDK has loaded is not traced. */
export function routerTransitionStart(
  ...args: Parameters<Sentry['captureRouterTransitionStart']>
): void {
  loaded?.captureRouterTransitionStart(...args);
}

/** Fetches the SDK when the browser is idle, or on the first error, and reports what it held. */
export function startSentryWhenIdle(win: Window & typeof globalThis): void {
  if (!options?.dsn) return;
  const held: unknown[] = [];
  const hold = (error: unknown) => {
    if (held.length < HELD_ERRORS_MAX) held.push(error);
    start();
  };
  const onError = (e: ErrorEvent) => hold(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => hold(e.reason);
  const start = () => {
    loadSentry()
      ?.then((sdk) => {
        // The SDK's own handlers are installed now, so these stop here.
        win.removeEventListener('error', onError);
        win.removeEventListener('unhandledrejection', onRejection);
        for (const error of held.splice(0)) sdk.captureException(error);
      })
      .catch(() => undefined);
  };
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  if (typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
  } else {
    win.setTimeout(start, IDLE_TIMEOUT_MS);
  }
}
