import type { SupabaseClient } from '@supabase/supabase-js';

// SPEC 04 §2 — the email-me-when-done completion send. Runs as a step INSIDE auditFn's existing
// flow (owner ruling 7: no new Inngest function, zero app-sync risk) and therefore NEVER throws —
// an email failure must never fail, retry, or alert an otherwise-successful audit.
//
// Idempotency: the notified_at claim (`.is('notified_at', null)`) happens BEFORE the send, so a
// step retry / concurrent attempt claims 0 rows and sends nothing. Trade-off (accepted): a send
// failure after a successful claim drops that one notification rather than risking duplicates —
// the wait valve is a courtesy, not a delivery guarantee.
//
// Content is neutral and non-customizable (abuse: anyone can enter any address on an anon audit's
// capability page): domain + capability link + a soft claim CTA + the "didn't request this" line.
// No grade/score — results live behind the link. The recipient address is user input; it is used
// as the send-to only, never interpolated into copy.

const SITE_ORIGIN = 'https://crawlmouse.com';
const FROM = 'Crawlmouse <magic@crawlmouse.com>';

export interface NotifyMessage {
  subject: string;
  text: string;
  html: string;
}

export type EmailSender = (to: string, msg: NotifyMessage) => Promise<void>;

/** Hostname of the audited URL for the subject line; falls back to a generic phrase. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'your site';
  }
}

export function buildNotifyEmail(input: { url: string; auditId: string }): NotifyMessage {
  const domain = domainOf(input.url);
  const link = `${SITE_ORIGIN}/audit/${input.auditId}`;
  const subject = `Your Crawlmouse report for ${domain} is ready`;
  const text = [
    `Your internal-linking report for ${domain} has finished.`,
    '',
    `View it here: ${link}`,
    '',
    `Want to make it yours? Claim the report from that page to save it to a dashboard and track your site over time.`,
    '',
    `If you didn't request this email, you can safely ignore it — someone entered your address while running a free audit at crawlmouse.com.`,
  ].join('\n');
  const html = [
    `<p>Your internal-linking report for <strong>${domain}</strong> has finished.</p>`,
    `<p><a href="${link}">View your report</a></p>`,
    `<p>Want to make it yours? Claim the report from that page to save it to a dashboard and track your site over time.</p>`,
    `<p style="color:#888;font-size:12px">If you didn't request this email, you can safely ignore it — someone entered your address while running a free audit at crawlmouse.com.</p>`,
  ].join('');
  return { subject, text, html };
}

/** Default sender: the Resend REST API (RESEND_API_KEY). A no-op when the key is absent. */
export function createResendSender(
  apiKey: string | undefined = process.env.RESEND_API_KEY,
  fetchImpl: typeof fetch = fetch,
): EmailSender {
  return async (to, msg) => {
    if (!apiKey) return;
    await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject: msg.subject, text: msg.text, html: msg.html }),
    });
  };
}

/**
 * Send the completion notification for a completed audit with a pending notify request.
 * NEVER throws; every failure path is a silent no-op (see the module contract above).
 */
export async function sendAuditNotification(
  sb: SupabaseClient,
  auditId: string,
  deps: { sendEmail?: EmailSender } = {},
): Promise<void> {
  const sendEmail = deps.sendEmail ?? createResendSender();
  try {
    const { data: row } = await sb
      .from('audits')
      .select('notify_email, notified_at, status, url')
      .eq('id', auditId)
      .maybeSingle<{ notify_email: string | null; notified_at: string | null; status: string; url: string }>();
    if (!row || !row.notify_email || row.notified_at || row.status !== 'completed') return;

    // Claim BEFORE sending: a retry that claims 0 rows must not double-send.
    const { data: claimed } = await sb
      .from('audits')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', auditId)
      .is('notified_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) return;

    await sendEmail(row.notify_email, buildNotifyEmail({ url: row.url, auditId }));
  } catch {
    /* swallowed: the valve is best-effort and must never affect the audit */
  }
}
