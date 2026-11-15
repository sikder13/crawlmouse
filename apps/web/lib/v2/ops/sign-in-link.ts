/**
 * Asks Supabase Auth to email a sign-in link (CC-33 D2's re-send, D6's canary), with the options the
 * magic-link route uses for its own links (`app/api/auth/magic-link/route.ts`: the link lands on
 * `/login/verify` under `NEXT_PUBLIC_BASE_URL`), except that it never creates a user. It does not go
 * through that route, so the route's Turnstile and rate limits are the caller's to apply: the console
 * applies the per-email bucket itself. The client is an anon one with no cookies and no session, so
 * the request carries nobody's session.
 *
 * Callers: app/api/internal/** and lib/v2/ops/functions.ts, which hands it to the sign-in canary
 * (sign-in-link.test.ts holds the list).
 */
import { createClient } from '@supabase/supabase-js';

/** Where the route's links land; sign-in-link.test.ts holds it equal to the route's. */
export const SIGN_IN_REDIRECT_PATH = '/login/verify';

export interface SignInLinkDeps {
  client: () => {
    auth: {
      signInWithOtp(args: {
        email: string;
        options: { shouldCreateUser: boolean; emailRedirectTo: string };
      }): Promise<{ error: { status?: number; message: string } | null }>;
    };
  };
  baseUrl: string;
}

const defaults = (): SignInLinkDeps => ({
  client: () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ),
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000',
});

/** `sent` when Auth accepted the request, `refused` when it answered an error (logged by status). */
export async function requestSignInLink(
  email: string,
  deps: SignInLinkDeps = defaults(),
): Promise<'sent' | 'refused'> {
  const { error } = await deps.client().auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${deps.baseUrl}${SIGN_IN_REDIRECT_PATH}`,
    },
  });
  if (error) {
    console.error(`ops: sign-in link refused (status ${error.status ?? 'none'})`);
    return 'refused';
  }
  return 'sent';
}
