// Server-side Turnstile gate. Pure (relative imports only, no `@/`) and injectable `verify` so
// it can be unit-tested without pulling the magic-link route's `@/` import chain into Vitest.
//
// Semantics (security-critical):
//   - secret unset  -> 'allow' and `verify` is NEVER called (dev fall-open; mirrors verifyTurnstileToken)
//   - secret set + no token -> 'block' (always-required when enabled; no token means no proof)
//   - secret set + token    -> delegate to `verify`: true -> 'allow', false -> 'block'

export type TurnstileGateOutcome = 'allow' | 'block';

export async function turnstileGate(
  secretConfigured: boolean,
  token: string | undefined,
  verify: (token: string) => Promise<boolean>,
): Promise<TurnstileGateOutcome> {
  if (!secretConfigured) return 'allow'; // dev fall-open; verify never called
  if (!token) return 'block'; // always-required when enabled
  return (await verify(token)) ? 'allow' : 'block';
}
