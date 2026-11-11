/**
 * A v2 check for the request being served, with the request's own viewer: whether it may be read
 * (`isReadableAudit`), and what an audit page shows of it (`readAudit`: `loadCheckFor`, once per
 * request, since a route's metadata and its page both ask).
 */
import 'server-only';
import { cache } from 'react';
import { loadCheckFor } from '../../../../lib/v2/pipeline/load-for';
import { readableCheck, type CheckRead } from '../../../../lib/v2/pipeline/public';
import { requestAccess } from '../../../../lib/v2/pipeline/public-deps';

/**
 * Whether `id` names a v2 check the request's viewer may read: `readableCheck`, which reads the
 * check's row and its site's (and asks membership for a kept one). For a caller that decides where
 * to send the reader and shows nothing of the check.
 */
export async function isReadableAudit(id: string): Promise<boolean> {
  const { deps, viewer } = await requestAccess();
  return (await readableCheck(deps, id, viewer)) !== null;
}

export const readAudit = cache(async (id: string): Promise<CheckRead | null> => {
  const { deps, viewer } = await requestAccess();
  return loadCheckFor(deps, id, viewer);
});
