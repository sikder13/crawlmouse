/**
 * `POST /api/unsubscribe` (CC-28 D7): the one-click target of `List-Unsubscribe` and the unsubscribe
 * page's form. The signed token is the credential (lib/v2/mail/unsubscribe.ts), verified before
 * anything else; a mail provider's POST comes from no page of ours, so the route takes a cross-site
 * request, as the webhooks do (route-policy.ts). The body is read up to `BODY_MAX` bytes. A 404 until
 * V2_CHECKS_PUBLIC=1.
 */
import { captureServerEvent, visitorDistinctId } from '@/lib/analytics-server';
import { checksPublicEnabled } from '@/lib/auth/flags';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { applyUnsubscribe, verifyUnsubscribeRequest } from '@/lib/v2/mail/unsubscribe';

export const runtime = 'nodejs';

/** The seat's account, or null when it cannot be read. */
async function seatAccount(sb: SupabaseClient, seatId: string): Promise<string | null> {
  try {
    const r = await sb.from('seats').select('account_id').eq('id', seatId).maybeSingle();
    return (r.data as { account_id: string } | null)?.account_id ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const verified = await verifyUnsubscribeRequest(req, process.env, new Date());
  if (!checksPublicEnabled()) return new Response(null, { status: 404 });
  const sb = supabaseAdmin();
  return applyUnsubscribe(
    verified,
    {
      async unsubscribe(seatId, kind) {
        const { data, error } = await sb.rpc('unsubscribe_seat', { p_seat: seatId, p_kind: kind });
        if (error) throw new Error(`unsubscribe_seat: ${error.code ?? 'error'}`);
        return data === true;
      },
      async captured(seatId, kind) {
        const cookie = req.headers.get('cookie');
        // The seat's account, so the event carries it and is marked when it is internal. A failed
        // read sends the event without it.
        const accountId = await seatAccount(sb, seatId);
        await captureServerEvent(cookie, {
          event: 'unsubscribed',
          // The link holder's browser, when its consented cookie names it (CC-41 D1); else the seat.
          distinctId: visitorDistinctId(cookie, null, `seat:${seatId}`),
          accountId,
          properties: { kind },
        });
      },
    },
    new URL(req.url).origin,
  );
}
