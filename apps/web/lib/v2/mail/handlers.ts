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
 *   Agency Plus     agency_plus_contact:<contactId>           (recipient: the sales inbox, always)
 *
 * A database read that fails before anything is claimed throws `MailRetry`: nothing was sent and
 * nothing claimed, so the step can safely try again. What happens from the claim to the ledger's
 * record is `send()`'s, which answers a failure there with `MailRetry` too; a fix email's `sent_at`
 * write that fails after the send is retried the same way.
 */
import type { EmailRequestedData, MailHandlers } from '../../../../../inngest/mail';
import { packetPrompt } from '../view/segment/fixes';
import { checkRef } from '../pipeline/public';
import { MailRetry, send, type MailDeps } from './send';
import type { MailStore } from './store';
import { accountDelete, emailChangeConfirm, emailChangeNotice } from './templates/account-links';
import { AGENCY_PLUS_INBOX, agencyPlusContact } from './templates/agency-plus-contact';
import { checkNotify } from './templates/check-notify';
import { fixToDeveloper } from './templates/fix-to-developer';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

  /**
   * An Agency Plus request: to the sales inbox, never to the address the form was given, which is
   * data in the body. A row already marked sent, or none, sends nothing; `sent_at` is set after the
   * send as the fix email's is.
   */
  async function agencyPlus(contactId: string): Promise<string> {
    if (!UUID.test(contactId)) return 'not_found';
    const r = await read(store.contactRequest(contactId));
    if (r === null) return 'not_found';
    if (r.sentAt !== null) return 'already_sent';
    const outcome = await send(mail, {
      kind: 'agency_plus_contact',
      to: AGENCY_PLUS_INBOX,
      idempotencyKey: `agency_plus_contact:${contactId}`,
      accountId: null,
      render: async () => agencyPlusContact({ email: r.email, sites: r.sites, note: r.note }),
    });
    if (outcome === 'sent' || outcome === 'done') {
      try {
        await store.markContactSent(contactId, mail.now());
      } catch {
        throw new MailRetry('mark_sent_failed');
      }
    }
    return outcome;
  }

  return {
    async accountEmail(data) {
      if (data.template === 'agency_plus_contact') return agencyPlus(data.contactId);
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
  };
}
