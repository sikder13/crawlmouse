/**
 * `POST /api/unsubscribe` (CC-28 D7): the one-click target of `List-Unsubscribe` and the unsubscribe
 * page's form. The signed token is the credential (lib/v2/mail/unsubscribe.ts), verified before
 * anything else; a mail provider's POST comes from no page of ours, so the route takes a cross-site
 * request, as the webhooks do (route-policy.ts). The body is read up to `BODY_MAX` bytes. A 404 until
 * V2_CHECKS_PUBLIC=1.
 */
import { captureServerEvent } from '@/lib/analytics-server';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { applyUnsubscribe, verifyUnsubscribeRequest } from '@/lib/v2/mail/unsubscribe';

export const runtime = 'nodejs';

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
      captured: (seatId, kind) =>
        captureServerEvent(req.headers.get('cookie'), {
          event: 'unsubscribed',
          distinctId: `seat:${seatId}`,
          properties: { kind },
        }),
    },
    new URL(req.url).origin,
  );
}
