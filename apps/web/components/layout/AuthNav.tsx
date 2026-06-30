'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { AuthNavView } from './AuthNavView';
import { subscribeAuthEmail } from './auth-nav-logic';

/**
 * Auth slot wiring. Reads the signed-in email from the BROWSER session (via subscribeAuthEmail) so the
 * server-rendered Header — present on every, mostly-anonymous, SEO-driven page — stays statically
 * rendered. Calling getUser() in the Header would pull in next/headers cookies() and force all those
 * pages dynamic, against the ≤18%-MRR cost discipline the middleware deliberately protects (it skips
 * getUser for anonymous requests). SSR / no-JS default = signed out (the Login link); the logout itself
 * is the robust server route in AuthNavView.
 */
export function AuthNav() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => subscribeAuthEmail(supabaseBrowser(), setEmail), []);
  return <AuthNavView email={email} />;
}
