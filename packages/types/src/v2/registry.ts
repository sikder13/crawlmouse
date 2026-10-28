import { z } from 'zod';

/**
 * Names for the v2 enums. A local registry rather than zod's global one, so v2 ids can never collide
 * with a schema registered elsewhere in the app. `.register()` returns the same schema object, which
 * the contract test relies on to track enum coverage by identity.
 */
export const v2Registry = z.registry<{ id: string }>();
