import { Webhook } from 'svix';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseResendEvent } from '@/lib/billing/resend-event';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const raw = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };
  let payload: unknown;
  try {
    payload = new Webhook(process.env.RESEND_WEBHOOK_SECRET!).verify(raw, headers);
  } catch {
    return new Response('invalid signature', { status: 400 });
  }
  const e = parseResendEvent(payload);
  await supabaseAdmin().from('email_events').upsert(
    { resend_event_id: headers['svix-id'], email_address: e.email, event_type: e.eventType, bounce_type: e.bounceType, payload },
    { onConflict: 'resend_event_id', ignoreDuplicates: true },
  );
  return new Response('ok');
}
