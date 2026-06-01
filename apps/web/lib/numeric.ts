/**
 * Coerce a value that may be a PostgREST-serialized numeric to a finite number.
 *
 * Postgres `numeric`/`decimal` columns (e.g. `audits.score`) are serialized by
 * PostgREST as JSON **strings** (`"87.50"`), not numbers. Code that does
 * `score.toFixed(...)` therefore crashes at runtime despite the value looking
 * numeric. Coerce once at the data boundary so every consumer can treat it as a
 * number (or null when absent/invalid).
 */
export function asNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
