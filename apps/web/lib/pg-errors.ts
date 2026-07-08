// Shared Postgres/PostgREST error helpers for deploy-order-safe reads/writes. A route/lib that
// selects or writes columns added by a not-yet-applied migration falls back to the legacy shape ONLY
// on a genuine "undefined column" error — never on a transient blip, which must not permanently
// degrade behavior.
//
// Two distinct surfaces produce "unknown column", with DIFFERENT codes:
//   - SELECT / filter of an unknown column → Postgres raises SQLSTATE 42703, passed through by
//     PostgREST (the report-read fallback path);
//   - an unknown column in a WRITE BODY (insert/update) → PostgREST validates against its schema
//     cache and returns PGRST204 ("Could not find the '<col>' column … in the schema cache"), NOT
//     42703 (the mint INSERT / hide UPDATE paths).
// Both must be recognized; a message check backstops version variance.

/** Postgres "undefined column" SQLSTATE (42703) — SELECT/filter of a missing column. */
export const UNDEFINED_COLUMN_CODE = '42703';
/** PostgREST "column not in schema cache" (PGRST204) — a missing column in a write body. */
export const POSTGREST_UNKNOWN_COLUMN_CODE = 'PGRST204';

export function isUndefinedColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === UNDEFINED_COLUMN_CODE || e.code === POSTGREST_UNKNOWN_COLUMN_CODE) return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('schema cache') || (msg.includes('column') && msg.includes('does not exist'));
}
