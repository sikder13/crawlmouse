import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import LoginPage from '@/app/login/page';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { safeNextPath } from '@/lib/safe-next-path';
import { supabaseServer } from '@/lib/supabase/server';

export { metadata } from '@/app/login/page';

/**
 * `/login` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404 with it off.
 * A person already signed in is sent on rather than shown the form (D-38): to the `next` target when
 * it is a same-origin path (`safeNextPath`, as the form's own sign-in uses), else to the dashboard.
 */
export default async function KeptLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const {
    data: { user },
  } = await (await supabaseServer()).auth.getUser();
  if (user) {
    const { next } = await searchParams;
    redirect((safeNextPath(typeof next === 'string' ? next : null) ?? '/dashboard') as Route);
  }
  return keptPage(LoginPage());
}
