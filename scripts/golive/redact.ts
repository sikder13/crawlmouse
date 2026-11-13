/**
 * The go-live check's single redactor. Every line the CLI writes, to stdout or stderr, and every error
 * it reports goes through `redact`, which replaces each registered value with `[redacted]`.
 *
 * Registered:
 * - every value of a `TOKEN_ENV` name in the process environment (`addSecret`, at any length);
 * - each value loaded from the env file (`addFileValue`): at any length when its name is token-named
 *   (`isTokenNamed`), otherwise only at `MIN_RECEIVED_LENGTH` or more, so `CRAWL_PAUSED=1` does not
 *   turn every `1` in the output into a mask;
 * - every string value a probe received in a response (`addReceived`, keys are not passed to it), at
 *   `MIN_RECEIVED_LENGTH` or more and not one of the public names the check itself prints
 *   (`vocabulary` in check.ts: environment names, lookup keys, migration versions, hosts, the worker
 *   app, the Vercel project and team ids, the production Supabase ref), which are code constants in
 *   this repository.
 */

export const MIN_RECEIVED_LENGTH = 12;

/** A name whose value is a secret at any length. */
export const isTokenNamed = (name: string): boolean =>
  (TOKEN_ENV as readonly string[]).includes(name) || /TOKEN|SECRET|KEY|PASSWORD|PEPPER/i.test(name);
export const MASK = '[redacted]';

/** The token names the check reads from scripts/.env.local or the environment. */
export const TOKEN_ENV = [
  'VERCEL_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
  'FLY_READ_TOKEN',
  'STRIPE_LIVE_READ_KEY',
  'RESEND_API_KEY',
] as const;

export class Redactor {
  private readonly values = new Set<string>();

  constructor(private readonly vocabulary: ReadonlySet<string> = new Set()) {}

  /** A value that is secret at any length (a token, anything from .env.local). */
  addSecret(value: string | undefined): void {
    if (!value) return;
    for (const form of forms(value)) if (form.length > 0) this.values.add(form);
  }

  /** A value loaded from the env file, under `name`. */
  addFileValue(name: string, value: string | undefined): void {
    if (!value) return;
    if (isTokenNamed(name)) this.addSecret(value);
    else if (value.trim().length >= MIN_RECEIVED_LENGTH) this.addSecret(value);
  }

  /** A string a probe received in a response. */
  addReceived(value: string): void {
    if (value.length < MIN_RECEIVED_LENGTH || this.vocabulary.has(value)) return;
    for (const form of forms(value)) this.values.add(form);
  }

  redact(text: string): string {
    let out = text;
    // Longest first, so a value that contains another is replaced whole.
    for (const v of [...this.values].sort((a, b) => b.length - a.length)) {
      if (out.includes(v)) out = out.split(v).join(MASK);
    }
    return out;
  }
}

/** The value as written, trimmed, and as JSON would quote it. */
function forms(value: string): string[] {
  const quoted = JSON.stringify(value).slice(1, -1);
  return [...new Set([value, value.trim(), quoted])];
}
