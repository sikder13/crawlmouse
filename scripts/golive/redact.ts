/**
 * The go-live check's single redactor. Every line the CLI writes, to stdout or stderr, and every error
 * it reports goes through `redact`, which replaces each registered value with `[redacted]`.
 *
 * Registered: every value loaded from `scripts/.env.local` and every value of a `TOKEN_ENV` name in
 * the process environment (by `addSecret`, at any length), and every string a probe received in a
 * response (by `addReceived`). A received string is skipped when it is shorter than
 * `MIN_RECEIVED_LENGTH` — replacing `true` or `1` everywhere would wreck the output, and the probes
 * print no received string anyway — or when it is one of the names the check itself prints
 * (`vocabulary`: environment names, lookup keys, migration versions, hosts), which are code
 * constants, public in this repository.
 */

export const MIN_RECEIVED_LENGTH = 8;
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
