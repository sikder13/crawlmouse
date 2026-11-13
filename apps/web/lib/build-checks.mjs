/**
 * Whether `next build` skips its own type check and lint.
 *
 * Only on Vercel (`VERCEL=1`, which Vercel sets on its build machines and CI does not). There the
 * two are duplicated work: `typecheck` and `lint` are required checks on `main`, and CI's `build`
 * job runs `next build` with both on. Vercel's standard build machine is smaller than CI's runner,
 * and the build's "Linting and checking validity of types" step ran it out of memory.
 *
 * Verify: pnpm --filter @crawlmouse/web exec vitest run __tests__/build-checks.test.ts
 */
export const skipBuildChecks = (env) => env.VERCEL === '1';
