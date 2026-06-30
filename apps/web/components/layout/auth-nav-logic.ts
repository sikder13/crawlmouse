// Minimal structural shape of the Supabase browser client's auth surface AuthNav needs — declared
// here so the subscription wiring is unit-testable without a DOM or the real client.
export interface AuthStateClient {
  auth: {
    onAuthStateChange: (
      cb: (event: string, session: { user?: { email?: string | null } | null } | null) => void,
    ) => { data: { subscription: { unsubscribe: () => void } } };
  };
}

/**
 * Subscribe to auth changes and feed the signed-in email to `onEmail` (null when signed out).
 * onAuthStateChange fires INITIAL_SESSION on subscribe (the stored session) and SIGNED_OUT after
 * logout, so the nav reflects auth with no extra network round-trip. Returns the unsubscribe cleanup.
 * Pure wiring → the subscribe, email mapping, and cleanup are unit-tested without a DOM.
 */
export function subscribeAuthEmail(
  sb: AuthStateClient,
  onEmail: (email: string | null) => void,
): () => void {
  const {
    data: { subscription },
  } = sb.auth.onAuthStateChange((_event, session) => {
    onEmail(session?.user?.email ?? null);
  });
  return () => subscription.unsubscribe();
}
