/**
 * The signed-in seat's theme on a page rendered per request outside the account shell (F-292):
 * the audit pages and the report page. It is cosmetic, so it can never fail a page.
 *
 * What it reads: the session's user (`auth.getUser()`, unless the page passes the user it already
 * has), the switcher cookie (`cm_account`), and the caller's active seats (`seats.id, account_id,
 * role, theme`, through the caller's own client). It chooses the seat as the viewer does
 * (`pickSeat`): the switcher's account, else the only seat, else the landing seat. Only that last
 * case reads more, the reads `landingSeat` makes: `users.default_account_id` (service role), and, for
 * an owner of other accounts, those accounts' kinds and whether the personal one has a site. Any
 * error, a missing user, or rows that do not parse give null: no theme, the device decides. It never
 * throws.
 *
 * The public report (`/r/<slug>`, served by `app/v2-report/[slug]`) is cached and does not call it
 * (`app/v2-report/[slug]/page.test.tsx`).
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ThemeSchema } from '@crawlmouse/types/v2';
import { SeatTheme } from '../../../components/v2/SeatTheme';
import { supabaseServer } from '../../supabase/server';
import { ACCOUNT_COOKIE, chosenAccount } from './viewer-cookie';
import { pickSeat, SeatRow, type ViewerDeps } from './viewer-read';
import { supabaseAdmin } from '../../supabase/admin';

type Theme = z.infer<typeof ThemeSchema>;

/**
 * The theme of the seat `userId` acts in, chosen as the viewer chooses it (`pickSeat`: the switcher's
 * account, else the only seat, else the landing seat); null when there is none, or on any error.
 */
export async function seatThemeFor(
  deps: Pick<ViewerDeps, 'session' | 'admin'>,
  userId: string,
  chosen: string | null,
): Promise<Theme | null> {
  try {
    const { data, error } = await deps.session
      .from('seats')
      .select('id, account_id, role, theme')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) return null;
    const rows = z.array(SeatRow).safeParse(data);
    if (!rows.success) return null;
    return (await pickSeat(deps, userId, rows.data, chosen))?.theme ?? null;
  } catch {
    return null;
  }
}

/**
 * The element that applies the session's seat theme, or null. `known` is the session client and user
 * a page has already read, so it is not read twice.
 */
export async function sessionTheme(known?: {
  session: SupabaseClient;
  user: { id: string } | null;
}): Promise<ReactElement | null> {
  try {
    let session = known?.session;
    let user = known?.user ?? null;
    if (!known) {
      const client = await supabaseServer();
      session = client;
      user = (await client.auth.getUser()).data.user;
    }
    if (!session || !user) return null;
    const chosen = chosenAccount((await cookies()).get(ACCOUNT_COOKIE)?.value);
    const theme = await seatThemeFor({ session, admin: supabaseAdmin() }, user.id, chosen);
    return theme === null ? null : <SeatTheme theme={theme} />;
  } catch {
    return null;
  }
}
