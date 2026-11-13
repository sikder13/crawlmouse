/**
 * What the two mails of a client report schedule read and mint in production (CC-31 D8): the port
 * `ReportMailStore` (store.ts) over the service-role client and section B's functions of migration
 * 20261114000002. The addresses read here are a send's recipient and nowhere else: no method logs
 * one, and an error names the call and Postgres's code only.
 *
 * A client report is mailed as three things made after the ledger's claim (`issueClientReport`):
 * its document, stored like any report's file (`generateReport`); a share link to it, whose token
 * is random and stored as its sha256 (`create_share_link`); and the schedule's pause link, whose
 * token is derived (report-pause-token.ts), so the link is the same in each report to one contact.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hashToken } from '../account/tokens';
import type { Generated } from '../reports/generate-run';
import { hashShareToken, newShareToken, type ShareFiles } from '../reports/share';
import { parseStoredDoc } from '../reports/share-doc';
import { reportDeclineToken } from './report-decline-token';
import { reportPauseToken } from './report-pause-token';
import type { ReportMailStore } from './store';

export interface ReportMailStoreDeps {
  admin: SupabaseClient;
  /** Makes and stores the document of a pending report (`generateReport`). */
  generate(reportId: string): Promise<Generated>;
  /** Reads a stored document. */
  files: Pick<ShareFiles, 'read'>;
  /**
   * `EMAIL_LINK_SECRET`, which the pause link's token is derived under. With none, a report cannot
   * be issued; the handler asks for none (`pauseLinks`, handlers.ts).
   */
  linkSecret: string | null;
}

const fail = (what: string, error: { code?: string } | null): never => {
  throw new Error(`report mail store: ${what}: ${error?.code ?? 'error'}`);
};

const SiteRow = z.object({
  account_id: z.uuid().nullable(),
  client_contact_email: z.string().nullable(),
});
const ReportRow = z.object({
  account_id: z.uuid(),
  site_id: z.uuid(),
  kind: z.string(),
  status: z.string(),
  recipient_email: z.string().nullable(),
  storage_path: z.string().nullable(),
  file_state: z.enum(['pending', 'stored', 'failed']).nullable(),
});
const Confirmation = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('issued'),
    token: z.string(),
    email: z.string(),
    host: z.string(),
    account_name: z.string().nullable(),
  }),
  z.object({ outcome: z.literal('none') }),
]);
const Pause = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('issued'),
    email: z.string(),
    host: z.string(),
    account_name: z.string().nullable(),
  }),
  z.object({ outcome: z.literal('none') }),
]);
const Link = z.object({ outcome: z.enum(['created', 'not_found', 'not_ready']) });
const Sent = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('sent'), account_id: z.uuid(), first: z.boolean() }),
  z.object({ outcome: z.enum(['already', 'not_found']) }),
]);

export function supabaseReportMailStore(deps: ReportMailStoreDeps): ReportMailStore {
  const { admin } = deps;
  const rpc = async <T>(fn: string, args: object, schema: z.ZodType<T>): Promise<T> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) fail(fn, error);
    return schema.parse(data);
  };
  /** A client report that waits to be sent, or null. */
  const waiting = async (reportId: string) => {
    const r = await admin
      .from('reports')
      .select('account_id, site_id, kind, status, recipient_email, storage_path, file_state')
      .eq('id', reportId)
      .maybeSingle();
    if (r.error) fail('reports', r.error);
    if (r.data === null) return null;
    const row = ReportRow.parse(r.data);
    if (row.kind !== 'client_report' || row.status !== 'scheduled') return null;
    if (row.recipient_email === null || row.storage_path === null) return null;
    return { ...row, recipient_email: row.recipient_email, storage_path: row.storage_path };
  };

  return {
    async confirmationRecipient(siteId) {
      const r = await admin
        .from('sites')
        .select('account_id, client_contact_email')
        .eq('id', siteId)
        .is('removed_at', null)
        .maybeSingle();
      if (r.error) fail('sites', r.error);
      if (r.data === null) return null;
      const site = SiteRow.parse(r.data);
      if (site.account_id === null || site.client_contact_email === null) return null;
      return { recipient: site.client_contact_email, accountId: site.account_id };
    },

    async confirmationsSince(accountId, addressHash, since, key) {
      return rpc(
        'report_confirm_mail_counts',
        {
          p_account: accountId,
          p_address_hash: addressHash,
          p_since: since.toISOString(),
          p_key: key,
        },
        z.object({ account: z.number().int(), address: z.number().int() }),
      );
    },

    async issueConfirmation(siteId, now, requestId, recipient) {
      if (deps.linkSecret === null) throw new Error('report mail store: no link secret');
      // The request's id names one ask: a retry of it is issued a link again, where another
      // request to a recipient who paused is refused within the window. The address is the one
      // the mail was claimed for: SQL issues nothing when the site's contact is no longer it, so
      // the "Don't ask me again" token, derived for that address, is stored for no other.
      const declineToken = reportDeclineToken(deps.linkSecret, siteId, recipient);
      const a = await rpc(
        'issue_recipient_confirmation',
        {
          p_site: siteId,
          p_now: now.toISOString(),
          p_request: requestId,
          p_email: recipient,
          p_decline_hash: hashToken(declineToken),
        },
        Confirmation,
      );
      if (a.outcome !== 'issued') return null;
      return {
        token: a.token,
        declineToken,
        recipient: a.email,
        agencyName: a.account_name,
        host: a.host,
      };
    },

    async clientReportRecipient(reportId) {
      const row = await waiting(reportId);
      return row === null ? null : { recipient: row.recipient_email, accountId: row.account_id };
    },

    async issueClientReport(reportId, now) {
      if (deps.linkSecret === null) throw new Error('report mail store: no link secret');
      const row = await waiting(reportId);
      if (row === null) return null;
      // First, whether there is still a schedule to send for: the row's address still the site's
      // contact, confirmed and not paused, on a site and an account that are still there. Only
      // then does the same call store the pause link's hash, which is the same for each report to
      // this contact.
      const pauseToken = reportPauseToken(deps.linkSecret, row.site_id, row.recipient_email);
      const pause = await rpc(
        'issue_report_pause',
        {
          p_site: row.site_id,
          p_email: row.recipient_email,
          p_token_hash: hashToken(pauseToken),
          p_now: now.toISOString(),
        },
        Pause,
      );
      if (pause.outcome !== 'issued') return null;

      // The document: made now for a row that has none, read back as the shared page will read it.
      if (row.file_state === 'failed') return null;
      if (row.file_state !== 'stored') {
        const made = await deps.generate(reportId);
        if (made.outcome === 'failed') return null;
      }
      const doc = parseStoredDoc(await deps.files.read(row.storage_path));
      if (doc === null) return null;

      // A new link each time this runs: a render that is retried replaces the one before, which
      // was not delivered.
      const shareToken = newShareToken();
      const link = await rpc(
        'create_share_link',
        {
          p_report: reportId,
          p_token_hash: hashShareToken(shareToken),
          p_user: null,
          p_now: now.toISOString(),
        },
        Link,
      );
      if (link.outcome !== 'created') return null;

      return {
        recipient: pause.email,
        agencyName: pause.account_name,
        host: pause.host,
        headline: doc.title,
        lines: doc.lines,
        footer: doc.footer.text,
        shareToken,
        pauseToken,
      };
    },

    async markClientReportSent(reportId, now) {
      const a = await rpc(
        'mark_client_report_sent',
        { p_report: reportId, p_now: now.toISOString() },
        Sent,
      );
      return a.outcome === 'sent' ? { accountId: a.account_id, first: a.first } : null;
    },
  };
}
