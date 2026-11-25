/**
 * The deploy hook's bucket, in a module that imports nothing: the site page's copy reads it, and that
 * copy is bundled into client components (`PublicLink.tsx`), which `limits.ts` cannot be, because it
 * reads the Inngest functions' bounds (`inngest/check`).
 */
/** Deploy hooks in one 10-minute bucket are one check (ARCH-2 §4.1, J9). */
export const DEPLOY_BUCKET_S = 600;
