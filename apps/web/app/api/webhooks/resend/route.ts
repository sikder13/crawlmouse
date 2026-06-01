import { Webhook } from 'svix';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseResendEvent } from '@/lib/billing/resend-event';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not set');
    return new Response('server misconfigured', { status: 500 });
  }

  const raw = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };
  let payload: unknown;
  try {
    payload = new Webhook(secret).verify(raw, headers);
  } catch {
    return new Response('invalid signature', { status: 400 });
  }

  const e = parseResendEvent(payload);
  // Ignore events we can't attribute to a real address — avoids junk rows and, once suppression
  // is wired (v1.1), prevents an unparsed/forged address from poisoning the suppression list.
  if (!headers['svix-id'] || !EMAIL_RE.test(e.email)) {
    return new Response('ignored', { status: 202 });
  }

  const { error } = await supabaseAdmin().from('email_events').upsert(
    { resend_event_id: headers['svix-id'], email_address: e.email, event_type: e.eventType, bounce_type: e.bounceType, payload },
    { onConflict: 'resend_event_id', ignoreDuplicates: true },
  );
  if (error) {
    console.error('[resend-webhook] email_events upsert failed:', error.message);
    return new Response('db error', { status: 500 });
  }
  return new Response('ok');
}
