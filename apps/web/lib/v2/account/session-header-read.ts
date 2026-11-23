/**
 * The header of a page rendered per request, from the session (RC-02, F-008): `sessionHeaderOf`
 * over `loadViewer`. Server only; a prerendered page uses `sessionHeaderFromCookies` instead
 * (lib/v2/session-header.ts says why).
 */
import 'server-only';
import { sessionHeaderOf, type SessionHeader } from '../session-header';
import { loadViewer } from './viewer';

export async function readSessionHeader(): Promise<SessionHeader> {
  return sessionHeaderOf(await loadViewer());
}
