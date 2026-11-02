import { notFound } from 'next/navigation';

/**
 * Whether the v2 previews answer, from the environment:
 *
 * - On Vercel, never. A Vercel deployment sets VERCEL and VERCEL_ENV; either one set, to any value
 *   (empty included), is enough, whatever else is set.
 * - Off Vercel on a production build (`next build && next start`), only with
 *   V2_PREVIEW_ON_NEXT_START=1, which CI sets to measure the previews on the production build.
 * - Off Vercel otherwise (`next dev`, the test runner), always.
 */
export function previewAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL !== undefined || env.VERCEL_ENV !== undefined) return false;
  if (env.NODE_ENV === 'production') return env.V2_PREVIEW_ON_NEXT_START === '1';
  return true;
}

/**
 * Call first in every v2 preview page (and the group's layout calls it too): a 404 wherever
 * previewAllowed says no. The group renders on each request (its layout's `dynamic`), so this reads
 * the running server's environment, not the one the build ran in.
 */
export function previewOnly(): void {
  if (!previewAllowed()) notFound();
}
