/**
 * The check an audit page shows, for the request being served: `loadCheckFor` with the request's
 * own viewer, once per request (the route's metadata and its page both ask).
 */
import 'server-only';
import { cache } from 'react';
import { loadCheckFor } from '../../../../lib/v2/pipeline/load-for';
import type { CheckRead } from '../../../../lib/v2/pipeline/public';
import { requestAccess } from '../../../../lib/v2/pipeline/public-deps';

export const readAudit = cache(async (id: string): Promise<CheckRead | null> => {
  const { deps, viewer } = await requestAccess();
  return loadCheckFor(deps, id, viewer);
});
