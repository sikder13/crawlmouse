/**
 * Whether this request reached a rewrite target through its rewrite (`lib/v2/rewrites.ts`). A target
 * page calls it first and answers 404 when it is false, so the page has no address of its own.
 */
import 'server-only';
import { headers } from 'next/headers';
import { REWRITE_HEADER } from './rewrites';

export async function reachedByRewrite(): Promise<boolean> {
  return (await headers()).get(REWRITE_HEADER) === '1';
}
