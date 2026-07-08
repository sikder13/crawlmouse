import type { SupabaseClient } from '@supabase/supabase-js';

// SPEC 04 §2 — the email-me-when-done completion send. Runs as a step INSIDE auditFn's existing
// flow on success AND from handleAuditFailure on terminal failure (owner ruling 7: no new Inngest
// function, zero app-sync risk) and therefore NEVER throws — an email failure must never fail,
// retry, or alert an otherwise-terminal audit.
//
// Fires for a COMPLETED or FAILED audit (not canceled — the user stopped it, they know): the
// "we'll email you when it's ready" promise must hold even when the crawl fails; the linked
// capability page renders the honest failure. Idempotency: the notified_at claim
// (`.is('notified_at', null)`) happens BEFORE the send, so a step retry / the success+failure paths
// racing claims 0 rows and sends nothing twice. Trade-off (accepted): a send failure after a
// successful claim drops that one notification rather than risking duplicates.
//
// Config guard: when RESEND is not configured we DON'T claim (notified_at stays null) so a later
// deploy with the key can still send — and we log, so a silently-dropped notification is visible.
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

export function buildNotifyEmail(input: { url: string; auditId: string; status?: string }): NotifyMessage {
  const domain = domainOf(input.url);
  const link = `${SITE_ORIGIN}/audit/${input.auditId}`;
  const failed = input.status === 'failed';
  const subject = failed
    ? `Your Crawlmouse audit for ${domain} finished`
    : `Your Crawlmouse report for ${domain} is ready`;
  const lead = failed
    ? `We finished checking ${domain}, but the audit didn't complete — open it to see what happened and re-run.`
    : `Your internal-linking report for ${domain} has finished.`;
  const cta = failed
    ? `View the details: ${link}`
    : `View it here: ${link}`;
  const text = [
    lead,
    '',
    cta,
    '',
    `Want to make it yours? Claim the report from that page to save it to a dashboard and track your site over time.`,
    '',
    `If you didn't request this email, you can safely ignore it — someone entered your address while running a free audit at crawlmouse.com.`,
  ].join('\n');
  const html = [
    `<p>${lead}</p>`,
    `<p><a href="${link}">${failed ? 'Open your audit' : 'View your report'}</a></p>`,
    `<p>Want to make it yours? Claim the report from that page to save it to a dashboard and track your site over time.</p>`,
    `<p style="color:#888;font-size:12px">If you didn't request this email, you can safely ignore it — someone entered your address while running a free audit at crawlmouse.com.</p>`,
  ].join('');
  return { subject, text, html };
}

/** Default sender: the Resend REST API (RESEND_API_KEY). Logs (never throws) on a non-2xx reply. */
export function createResendSender(
  apiKey: string | undefined = process.env.RESEND_API_KEY,
  fetchImpl: typeof fetch = fetch,
): EmailSender {
  return async (to, msg) => {
    if (!apiKey) return;
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) {
      // Observability: a dropped notification (bad key, Resend outage) must not be silent.
      console.error(`[notify] Resend send returned ${res.status}`);
    }
  };
}

export interface SendNotificationDeps {
  sendEmail?: EmailSender;
  /** Whether email delivery is configured; when false we skip WITHOUT claiming (see the guard above). */
  isConfigured?: () => boolean;
}

/**
 * Send the completion notification for a completed OR failed audit with a pending notify request.
 * NEVER throws; every failure path is a silent no-op (see the module contract above).
 */
export async function sendAuditNotification(
  sb: SupabaseClient,
  auditId: string,
  deps: SendNotificationDeps = {},
): Promise<void> {
  // Configured when a sender is injected (tests) or the API key is present (prod).
  const configured = deps.isConfigured ? deps.isConfigured() : deps.sendEmail ? true : !!process.env.RESEND_API_KEY;
  const sendEmail = deps.sendEmail ?? createResendSender();
  try {
    const { data: row } = await sb
      .from('audits')
      .select('notify_email, notified_at, status, url')
      .eq('id', auditId)
      .maybeSingle<{ notify_email: string | null; notified_at: string | null; status: string; url: string }>();
    if (!row || !row.notify_email || row.notified_at) return;
    if (row.status !== 'completed' && row.status !== 'failed') return;

    // Not configured: do NOT claim — leave notified_at null so a later deploy with the key sends.
    if (!configured) {
      console.warn(`[notify] RESEND not configured; leaving audit ${auditId} unnotified for a later send`);
      return;
    }

    // Claim BEFORE sending: a retry / the success+failure paths racing must not double-send.
    const { data: claimed } = await sb
      .from('audits')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', auditId)
      .is('notified_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) return;

    await sendEmail(row.notify_email, buildNotifyEmail({ url: row.url, auditId, status: row.status }));
  } catch {
    /* swallowed: the valve is best-effort and must never affect the audit */
  }
}
