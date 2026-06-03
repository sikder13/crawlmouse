// Pure classifier for the waitlist insert result, kept relative-import-only so the idempotency
// invariant is unit-tested without the @/ alias. A repeat signup hits the (lower(email), source)
// unique index -> Postgres 23505 -> treated as success (idempotent), exactly like reports/mint.
// Any other DB error is a real failure.
export interface PgErrorLike {
  code?: string | null;
}
export interface InsertOutcome {
  ok: boolean;
  status: number;
}
export function classifyWaitlistInsert(error: PgErrorLike | null): InsertOutcome {
  if (!error) return { ok: true, status: 200 };
  if (error.code === '23505') return { ok: true, status: 200 }; // duplicate = idempotent success
  return { ok: false, status: 500 };
}
