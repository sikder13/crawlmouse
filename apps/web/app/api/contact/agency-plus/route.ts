import { billingV2Enabled } from '@/lib/billing/flags';
import { getClientIp } from '@/lib/client-ip';
import { inngest } from '@/lib/inngest';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { turnstileEnforced } from '@/lib/turnstile-policy';
import { answer, contactAgencyPlus, CONTACT_PER_IP_PER_DAY } from './_lib/contact';

const DAY_MS = 24 * 60 * 60 * 1000;

export const runtime = 'nodejs';

/**
 * The Agency Plus contact form (CC-29 D2): a 404 while V2_BILLING is off, then the JSON body to
 * ./_lib/contact.ts, which says what it checks and in what order.
 */
export async function POST(req: Request) {
  if (!billingV2Enabled()) return answer(404, { error: 'not_found' });
  const body: unknown = await req.json().catch(() => null);
  return contactAgencyPlus(body, {
    ip: getClientIp(req),
    rateLimit: (key) => checkRateLimit(key, CONTACT_PER_IP_PER_DAY, DAY_MS),
    turnstileEnforced: turnstileEnforced(process.env),
    verifyTurnstile: verifyTurnstileToken,
    async insert(row) {
      const { data, error } = await supabaseAdmin()
        .from('contact_requests')
        .insert(row)
        .select('id')
        .single();
      if (error) throw new Error(`contact_requests insert failed: ${error.message}`);
      return (data as { id: string }).id;
    },
    send: (event) => inngest.send(event),
  });
}
