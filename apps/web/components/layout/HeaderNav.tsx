'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { UrlObject } from 'url';
import { supabaseBrowser } from '@/lib/supabase/client';
import { subscribeAuthEmail } from './auth-nav-logic';
import { AuthNavView } from './AuthNavView';
import { MobileMenuView } from './MobileMenuView';

const r = (p: string): UrlObject => ({ pathname: p });

/**
 * The responsive header nav. Reads the signed-in email ONCE from the browser session (so the
 * server-rendered Header stays static — no getUser/cookies in the Header, the ≤18%-MRR cost discipline)
 * and renders both layouts: an inline nav at >= sm (Pricing | Dashboard | AuthNavView) and a hamburger
 * MobileMenuView at < sm, so nothing overflows a ~390px phone. SSR / no-JS default = signed out (Login).
 */
export function HeaderNav() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => subscribeAuthEmail(supabaseBrowser(), setEmail), []);
  return (
    <>
      <nav className="hidden sm:flex items-center gap-6 text-sm font-medium">
        <Link href={r('/pricing')} className="hover:text-peach transition-colors">Pricing</Link>
        <Link href={r('/dashboard')} className="hover:text-peach transition-colors">Dashboard</Link>
        <AuthNavView email={email} />
      </nav>
      <MobileMenuView email={email} />
    </>
  );
}
