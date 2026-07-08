// Shared Postgres error helpers for deploy-order-safe reads/writes. A route/lib that selects or
// writes columns added by a not-yet-applied migration falls back to the legacy shape ONLY on the
// specific "undefined column" SQLSTATE — never on a transient blip, which must not permanently
// degrade behavior.

/** Postgres "undefined column" SQLSTATE (42703) — the pre-migration state for a new column. */
export const UNDEFINED_COLUMN_CODE = '42703';

export function isUndefinedColumnError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === UNDEFINED_COLUMN_CODE;
}
