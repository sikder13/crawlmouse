/**
 * The signed-in seat's theme on a page rendered per request outside the account shell (F-292):
 * the audit pages and the report page. It is cosmetic, so it can never fail a page.
 *
 * What it reads: the session's user (`auth.getUser()`, unless the page passes the user it already
 * has), the switcher cookie (`cm_account`), and one query, `seats.account_id, theme` for that user's
 * active seats, through the caller's own client (row security answers it). The seat is the one of the
 * account the switcher cookie names; without one, the theme the user's seats share. Any error, a
 * missing user, a seat it cannot pick, or rows that do not parse give null: no theme, the device
 * decides. It never throws.
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

type Theme = z.infer<typeof ThemeSchema>;
const SeatThemeRows = z.array(z.object({ account_id: z.string(), theme: ThemeSchema }));

/** The theme of `userId`'s seat on `chosen`, else the one their active seats share; null otherwise. */
export async function seatThemeFor(
  session: Pick<SupabaseClient, 'from'>,
  userId: string,
  chosen: string | null,
): Promise<Theme | null> {
  try {
    const { data, error } = await session
      .from('seats')
      .select('account_id, theme')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) return null;
    const rows = SeatThemeRows.safeParse(data);
    if (!rows.success) return null;
    const picked = chosen === null ? undefined : rows.data.find((s) => s.account_id === chosen);
    if (picked) return picked.theme;
    const themes = new Set(rows.data.map((s) => s.theme));
    return themes.size === 1 ? [...themes][0]! : null;
  } catch {
    return null;
  }
}

/**
 * The element that applies the session's seat theme, or null. `known` is the session client and user
 * a page has already read, so it is not read twice.
 */
export async function sessionTheme(known?: {
  session: Pick<SupabaseClient, 'from'>;
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
    const theme = await seatThemeFor(session, user.id, chosen);
    return theme === null ? null : <SeatTheme theme={theme} />;
  } catch {
    return null;
  }
}
