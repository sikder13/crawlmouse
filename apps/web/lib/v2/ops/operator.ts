/**
 * Who may use the support console (CC-33 D1, D2). `requireOperator` asks the caller's own session:
 * `getUser()`, then `is_operator()` (migration 20261115000001), which answers from the `operators`
 * table for `auth.uid()`. It answers a proof only for a strict `true`; anything else, an error
 * included, is null, and a page or route then answers 404.
 *
 * `consoleAdmin` is the console's one way to a service-role client, and it takes that proof: its type
 * is branded, so a call without one does not compile, and a proof this module did not issue (a cast
 * object) throws before the client is made.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../supabase/admin';

declare const issued: unique symbol;

/** What `requireOperator` answers for an operator: their user id, and a brand no cast supplies. */
export interface OperatorProof {
  readonly userId: string;
  readonly [issued]: true;
}

/** The parts of a session client `requireOperator` uses. */
export interface OperatorSession {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
  rpc(fn: 'is_operator'): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const proofs = new WeakSet<object>();

export async function requireOperator(session: OperatorSession): Promise<OperatorProof | null> {
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return null;
  const { data, error } = await session.rpc('is_operator');
  if (error) {
    console.error(`ops: is_operator failed: ${error.message}`);
    return null;
  }
  if (data !== true) return null;
  const proof = Object.freeze({ userId: user.id }) as OperatorProof;
  proofs.add(proof);
  return proof;
}

/** True for a proof `requireOperator` issued in this process. */
export const isIssued = (proof: unknown): proof is OperatorProof =>
  typeof proof === 'object' && proof !== null && proofs.has(proof);

/** The service-role client, for a caller `requireOperator` has passed. */
export function consoleAdmin(
  proof: OperatorProof,
  make: () => SupabaseClient = supabaseAdmin,
): SupabaseClient {
  if (!isIssued(proof)) throw new Error('consoleAdmin: not a proof requireOperator issued');
  return make();
}
