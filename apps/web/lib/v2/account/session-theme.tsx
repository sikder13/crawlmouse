/**
 * The signed-in seat's theme on a page rendered per request outside the account shell (F-292):
 * the audit pages and the report page. It reads the seat's theme from the session
 * (`readSessionHeader`, the F-101 helper) and gives the `SeatTheme` that applies it as the
 * dashboard's `ThemeControl` does. A visitor who is not signed in, or a person with no seat, gets
 * nothing, so their device decides.
 *
 * Server only, and it reads the session cookie, so a page that calls it is rendered per request.
 * The public report (`/r/<slug>`, served by `app/v2-report/[slug]`) is cached and does not call it
 * (`app/v2-report/[slug]/page.test.tsx`).
 */
import 'server-only';
import type { ReactElement } from 'react';
import { SeatTheme } from '../../../components/v2/SeatTheme';
import { readSessionHeader } from './session-header-read';

/** The element that applies the session's seat theme, or null when there is none to apply. */
export async function sessionTheme(): Promise<ReactElement | null> {
  const header = await readSessionHeader();
  return header.kind === 'signed_in' && header.theme !== null ? (
    <SeatTheme theme={header.theme} />
  ) : null;
}
