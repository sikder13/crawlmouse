/**
 * Whether a server event is about an internal account (CC-33 D1), for `captureServerEvent`
 * (lib/analytics-server.ts), which adds `internal: true` to such an event's properties.
 *
 * What an event says about its account: its distinct id, `account:<uuid>`, `seat:<uuid>` or a bare
 * uuid (an account's or a user's), and an `accountId` its caller passes. `check:<ref>`,
 * `report:<slug>` and `anon:<uuid>` name no account and are not looked up. Each subject is one
 * service-role call to `is_internal_subject` (migration 20261115000001), remembered for 60 seconds.
 * A lookup that fails answers false (the event is sent unmarked) and logs one line without the id.
 */
import { createClient } from '@supabase/supabase-js';

export type Subject = { kind: 'account' | 'seat' | 'any'; id: string };
export type InternalLookup = (s: Subject) => Promise<boolean>;

/** How long a lookup's answer is kept. */
export const INTERNAL_CACHE_MS = 60_000;
/** How long one lookup may take before it is abandoned (and answers false). */
export const INTERNAL_LOOKUP_TIMEOUT_MS = 1_000;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PREFIXED = new RegExp(`^(account|seat):(${UUID})$`);
const BARE = new RegExp(`^${UUID}$`);

export function subjectsOf(distinctId: string, accountId?: string | null): Subject[] {
  const out: Subject[] = [];
  const prefixed = PREFIXED.exec(distinctId);
  if (prefixed) out.push({ kind: prefixed[1] as 'account' | 'seat', id: prefixed[2]! });
  else if (BARE.test(distinctId)) out.push({ kind: 'any', id: distinctId });
  if (
    typeof accountId === 'string' &&
    BARE.test(accountId) &&
    !out.some((s) => s.kind === 'account' && s.id === accountId)
  ) {
    out.push({ kind: 'account', id: accountId });
  }
  return out;
}

/** `lookup`, its answers kept for INTERNAL_CACHE_MS, and failing open to false. */
export function cachedLookup(lookup: InternalLookup, now: () => number = Date.now): InternalLookup {
  const kept = new Map<string, { value: boolean; until: number }>();
  return async (s) => {
    const key = `${s.kind}:${s.id}`;
    const hit = kept.get(key);
    if (hit !== undefined && hit.until > now()) return hit.value;
    try {
      const value = await lookup(s);
      kept.set(key, { value, until: now() + INTERNAL_CACHE_MS });
      return value;
    } catch {
      console.error('analytics: internal lookup failed');
      return false;
    }
  };
}

/** The one call a lookup makes. */
export interface InternalRpc {
  rpc(
    fn: 'is_internal_subject',
    args: { p_kind: Subject['kind']; p_id: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** `is_internal_subject` through `client`, abandoned after INTERNAL_LOOKUP_TIMEOUT_MS. */
export function rpcInternalLookup(client: () => InternalRpc): InternalLookup {
  return async (s) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), INTERNAL_LOOKUP_TIMEOUT_MS);
    });
    try {
      const { data, error } = await Promise.race([
        client().rpc('is_internal_subject', { p_kind: s.kind, p_id: s.id }),
        late,
      ]);
      if (error) throw new Error(error.message);
      return data === true;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The service-role client, from the environment when a lookup is made. */
const serviceRole = (): InternalRpc => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('no service-role credentials');
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as InternalRpc;
};

/** The process's lookup: the service-role one, cached. */
export const defaultInternalLookup: InternalLookup = cachedLookup(rpcInternalLookup(serviceRole));

export async function isInternalEvent(
  distinctId: string,
  accountId: string | null | undefined,
  lookup: InternalLookup = defaultInternalLookup,
): Promise<boolean> {
  for (const s of subjectsOf(distinctId, accountId)) if (await lookup(s)) return true;
  return false;
}
