// Server-side Turnstile gate. Pure (relative imports only, no `@/`) and injectable `verify` so
// it can be unit-tested without pulling the magic-link route's `@/` import chain into Vitest.
//
// Semantics (security-critical). `enforced` comes from turnstileEnforced(): true when a secret is
// configured OR the runtime is production (where a missing secret must fail closed, not open).
//   - not enforced     -> 'allow' and `verify` is NEVER called (dev/preview fall-open)
//   - enforced, no token -> 'block' (no token means no proof)
//   - enforced + token   -> delegate to `verify`: true -> 'allow', false -> 'block'
//     (verifyTurnstileToken returns false in production when the secret is missing)

export type TurnstileGateOutcome = 'allow' | 'block';

export async function turnstileGate(
  enforced: boolean,
  token: string | undefined,
  verify: (token: string) => Promise<boolean>,
): Promise<TurnstileGateOutcome> {
  if (!enforced) return 'allow'; // dev/preview fall-open; verify never called
  if (!token) return 'block'; // always-required when enforced
  return (await verify(token)) ? 'allow' : 'block';
}
