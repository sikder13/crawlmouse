/**
 * The mail handlers inngest/mail.ts runs (D2, D11), over injected ports. Each reads what it needs,
 * decides whether there is anything to send, and sends through `send()` with an idempotency key built
 * from the event's ids, so a replayed event, a retried step or the second of two triggers claims the
 * same ledger row and sends nothing more:
 *
 *   account links   account_link:<tokenId>                    (recipient: account_link_recipient)
 *   trial reminder  trial_reminder:<accountId>:<trialEndsAt>  (one per trial end)
 *   check notify    check_notify:<checkId>
 *   fix to a dev    fix_to_developer:<requestId>
 *   seat invite     seat_invite:<seatId>:<seq>                (recipient: the seat's invited address)
 *
 * `reportMailHandlers` holds the two mails of a client report schedule, over their own port:
 *
 *   confirmation    report_confirm:<siteId>:<requestId>       (recipient: the site's client contact)
 *   client report   client_report:<reportId>
 *
 * The invitation's link, the confirmation's and a report's two are minted inside `render`, after the
 * claim, as an account link is (Q10).
 *
 * A database read that fails before anything is claimed throws `MailRetry`: nothing was sent and
 * nothing claimed, so the step can safely try again. What happens from the claim to the ledger's
 * record is `send()`'s, which answers a failure there with `MailRetry` too; a fix email's `sent_at`
 * write that fails after the send is retried the same way.
 */
import type {
  EmailRequestedData,
  MailHandlers,
  ReportMailHandlers,
} from '../../../../../inngest/mail';
import { packetPrompt } from '../view/segment/fixes';
import type { AgencyCapture } from '../agency/events';
import { checkRef } from '../pipeline/public';
import { unsubscribeHeaders } from './headers';
import { reportPauseUrl } from './links';
import { MailRetry, send, type MailDeps } from './send';
import type { MailStore, ReportMailStore } from './store';
import { accountDelete, emailChangeConfirm, emailChangeNotice } from './templates/account-links';
import { checkNotify } from './templates/check-notify';
import { clientReport } from './templates/client-report';
import { fixToDeveloper } from './templates/fix-to-developer';
import { reportConfirm } from './templates/report-confirm';
import { seatInvite } from './templates/seat-invite';
import { trialReminder } from './templates/trial-reminder';
import type { RenderedMail } from './types';

/** Sends a product event with no request (no cookie header): `captureServerEvent(null, …)`. */
export type CaptureEvent = (
  event: 'check_finished',
  distinctId: string,
  properties: Readonly<Record<string, unknown>>,
) => Promise<void>;

export interface MailHandlerDeps {
  mail: MailDeps;
  store: MailStore;
  capture: CaptureEvent;
}

/** The link row each account template's `tokenId` names (CC-27b's emits). */
const LINK_KIND = {
  email_change_confirm: 'email_change',
  email_change_notice: 'email_change_undo',
  account_delete: 'delete_confirm',
} as const;

const ENDED = new Set(['finished', 'partial', 'failed']);
const TRIAL_STATES = { pro_trial: 'pro', agency_trial: 'agency' } as const;

/** A read before any claim: a failure is retried, since nothing has been sent or claimed. */
async function read<T>(what: Promise<T>): Promise<T> {
  try {
    return await what;
  } catch {
    throw new MailRetry('read_failed');
  }
}

export function mailHandlers(d: MailHandlerDeps): MailHandlers {
  const { mail, store } = d;

  async function accountLink(
    data: Extract<EmailRequestedData, { tokenId: string }>,
  ): Promise<string> {
    const row = await read(store.accountLinkRecipient(data.tokenId));
    if (row === null) return 'link_unusable';
    if (row.kind !== LINK_KIND[data.template]) return 'kind_mismatch';
    return send(mail, {
      kind: data.template,
      to: row.recipient,
      idempotencyKey: `account_link:${data.tokenId}`,
      accountId: data.accountId,
      // Minted only now, after the claim answered go (Q10); the token goes into the link and nowhere else.
      render: async (): Promise<RenderedMail | null> => {
        const issued = await store.issueAccountLink(data.tokenId);
        const token = (kind: string) => issued.find((l) => l.kind === kind)?.token;
        const main = token(row.kind);
        if (main === undefined) return null;
        if (data.template === 'email_change_confirm') return emailChangeConfirm({ token: main });
        if (data.template === 'email_change_notice') return emailChangeNotice({ token: main });
        const restore = token('delete_restore');
        return restore === undefined
          ? null
          : accountDelete({ confirmToken: main, restoreToken: restore });
      },
    });
  }

  async function trial(accountId: string): Promise<string> {
    const a = await read(store.trialAccount(accountId));
    if (a === null) return 'not_found';
    if (a.marked) return 'marked';
    if (!a.remind) return 'opted_out';
    const plan = TRIAL_STATES[a.state as keyof typeof TRIAL_STATES];
    if (plan === undefined || a.trialEndsAt === null || a.trialVariant === null) {
      return 'not_in_trial';
    }
    const endsAt = new Date(a.trialEndsAt);
    if (endsAt.getTime() <= mail.now().getTime()) return 'trial_over';
    if (a.ownerEmail === null) return 'no_owner';
    return send(mail, {
      kind: 'trial_reminder',
      to: a.ownerEmail,
      idempotencyKey: `trial_reminder:${accountId}:${endsAt.toISOString()}`,
      accountId,
      render: async () =>
        trialReminder({
          plan,
          variant: a.trialVariant!,
          endsAt: endsAt.toISOString(),
          timezone: a.timezone,
        }),
    });
  }

  return {
    async accountEmail(data) {
      return data.template === 'trial_reminder' ? trial(data.accountId) : accountLink(data);
    },

    async checkNotify(checkId) {
      const c = await read(store.notifyCheck(checkId));
      if (c === null) return 'not_found';
      if (c.notifyEmail === null) return 'no_address';
      if (!ENDED.has(c.status)) return 'waiting';
      return send(mail, {
        kind: 'check_notify',
        to: c.notifyEmail,
        idempotencyKey: `check_notify:${checkId}`,
        accountId: c.accountId,
        render: async () =>
          checkNotify({
            host: c.host,
            checkId,
            outcome: c.status === 'failed' ? 'failed' : 'finished',
          }),
      });
    },

    async fixToDeveloper(requestId) {
      const r = await read(store.fixEmailRequest(requestId));
      if (r === null) return 'not_found';
      if (r.fix.packet === null) return 'no_packet';
      const packet = r.fix.packet;
      const outcome = await send(mail, {
        kind: 'fix_to_developer',
        to: r.toEmail,
        idempotencyKey: `fix_to_developer:${requestId}`,
        accountId: r.accountId,
        render: async () =>
          fixToDeveloper({
            host: r.host,
            fixTitle: r.fix.title,
            packet: packetPrompt(r.fix, packet),
          }),
      });
      // `done`: sent by an earlier run that stopped before recording it. A failed write is retried:
      // the ledger already answers `done`, so the retry records the time and sends nothing.
      if (outcome === 'sent' || outcome === 'done') {
        try {
          await store.markFixEmailSent(requestId, mail.now());
        } catch {
          throw new MailRetry('mark_sent_failed');
        }
      }
      return outcome;
    },

    async checkFinished(checkId) {
      const c = await read(store.finishedCheck(checkId));
      if (c === null) return 'not_found';
      const ref = checkRef(checkId);
      await d.capture(
        'check_finished',
        c.accountId === null ? `check:${ref}` : `account:${c.accountId}`,
        { trigger: c.trigger, status: c.status, check_ref: ref, source: 'pipeline' },
      );
      return 'captured';
    },

    async seatInvite(seatId, seq) {
      const invitation = await read(store.seatInvitation(seatId, seq));
      if (invitation === null) return 'not_invited';
      if (invitation.marked) return 'marked';
      return send(mail, {
        kind: 'seat_invite',
        to: invitation.recipient,
        idempotencyKey: `seat_invite:${seatId}:${seq}`,
        accountId: invitation.accountId,
        // Minted only now, after the claim answered go: a retry of this key mints nothing, and a
        // resend is another key. The token goes into the link and nowhere else.
        render: async () => {
          const issued = await store.issueSeatInvite(seatId, seq, mail.now());
          // No row: accepted, removed, re-sent or its account marked since the read above. The
          // link is mailed only to the address it was issued for.
          if (issued === null || issued.recipient !== invitation.recipient) return null;
          return seatInvite({
            token: issued.token,
            accountName: issued.accountName,
            role: issued.role,
          });
        },
      });
    },
  };
}

/** The longest `request_id` a confirmation's ledger key takes; the key itself holds 200 characters. */
export const REQUEST_ID_MAX = 100;

export interface ReportMailHandlerDeps {
  mail: MailDeps;
  store: ReportMailStore;
  /** `first_client_report_sent`, when the report mailed is the account's first (CC-31 D10). */
  capture: AgencyCapture;
  /**
   * Whether the pause link can be made (`EMAIL_LINK_SECRET` is set). A report is not mailed
   * without its pause link: with this false, nothing is read, claimed or sent.
   */
  pauseLinks: boolean;
}

export function reportMailHandlers(d: ReportMailHandlerDeps): ReportMailHandlers {
  const { mail, store, capture } = d;
  return {
    async reportConfirm(siteId, requestId) {
      if (requestId.length === 0 || requestId.length > REQUEST_ID_MAX) return 'invalid_request';
      const contact = await read(store.confirmationRecipient(siteId));
      if (contact === null) return 'not_found';
      return send(mail, {
        kind: 'report_confirm',
        to: contact.recipient,
        idempotencyKey: `report_confirm:${siteId}:${requestId}`,
        accountId: contact.accountId,
        render: async () => {
          const issued = await store.issueConfirmation(siteId, mail.now());
          if (issued === null || issued.recipient !== contact.recipient) return null;
          return reportConfirm({
            token: issued.token,
            agencyName: issued.agencyName,
            host: issued.host,
          });
        },
      });
    },

    async clientReport(reportId) {
      if (!d.pauseLinks) {
        mail.log('mail.unconfigured', { kind: 'client_report', link_secret: 0 });
        return 'unconfigured';
      }
      const contact = await read(store.clientReportRecipient(reportId));
      if (contact === null) return 'not_found';
      // Set by `render`, which `send` calls before it asks for the headers.
      let unsubscribe: Readonly<Record<string, string>> = {};
      const outcome = await send(mail, {
        kind: 'client_report',
        to: contact.recipient,
        idempotencyKey: `client_report:${reportId}`,
        accountId: contact.accountId,
        render: async () => {
          const issued = await store.issueClientReport(reportId, mail.now());
          if (issued === null || issued.recipient !== contact.recipient) return null;
          // The pause link is the message's footer link and its one-click List-Unsubscribe target.
          unsubscribe = unsubscribeHeaders({ url: reportPauseUrl(issued.pauseToken) });
          return clientReport({
            agencyName: issued.agencyName,
            host: issued.host,
            headline: issued.headline,
            lines: issued.lines,
            footer: issued.footer,
            shareToken: issued.shareToken,
            pauseToken: issued.pauseToken,
          });
        },
        headers: () => unsubscribe,
      });
      // The row becomes `sent` once its mail has gone. `done` is a mail an earlier run sent and
      // stopped before it marked: the mark is made now, and a report already marked answers null.
      if (outcome === 'sent' || outcome === 'done') {
        const marked = await store.markClientReportSent(reportId, mail.now());
        if (marked?.first) await capture('first_client_report_sent', marked.accountId, {});
      }
      return outcome;
    },
  };
}
