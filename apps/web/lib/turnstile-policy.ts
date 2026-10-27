// When Turnstile must be enforced. Pure and env-injected (relative imports only, no `server-only`) so it
// is unit-testable and shared by every route that gates on Turnstile.

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Whether this runtime is the production deployment. `VERCEL_ENV` decides whenever it is set, so a Vercel
 * preview (which runs with NODE_ENV=production) is NOT production. `NODE_ENV` is consulted only when
 * `VERCEL_ENV` is unset or empty — an off-Vercel `next start`.
 */
export function isProductionDeployment(env: Env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production';
  return env.NODE_ENV === 'production';
}

/**
 * Whether a route must require a Turnstile token: a secret is configured, or this is production. In
 * production a missing secret is a misconfiguration, so the gate stays on and verification fails closed
 * (see verifyTurnstileToken) instead of silently opening. Preview and development without a secret keep
 * the permissive path.
 */
export function turnstileEnforced(env: Env): boolean {
  return !!env.TURNSTILE_SECRET_KEY || isProductionDeployment(env);
}
