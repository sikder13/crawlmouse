/**
 * alertFn's work (CC-28 D5), behind ports so it runs without a database, a mail provider or Slack.
 *
 * `plan` reads the finished check and says whether it can alert at all: not for a check of an audit
 * nobody kept or of a removed site, not for an account marked for deletion, not for a site's first
 * check. `deliver` then sends one channel: it reads the check again and evaluates the rules
 * (`evaluateAlerts`), so each Inngest step carries only a small answer, and the result is the same
 * on every retry because a finished check's changes do not change.
 *
 * - Email: one message per recipient seat whose client scope covers the site (`alert_email_recipients`), keyed
 *   `alert:<checkId>:email:<seatId>` in the send ledger, so a retried step sends nobody twice; with
 *   List-Unsubscribe for that seat. Every seat is tried on every run (`sendEach`): a seat whose send
 *   throws stops no other, and the step throws after the channel is recorded. No `EMAIL_LINK_SECRET`, no mail (Q6): the miss is logged and
 *   recorded `suppressed`.
 * - Slack: one message per check, claimed in `slack_sends` as `alert:<checkId>:slack`, when a firing
 *   rule names Slack and the account's tier has Slack now (`account_slack_webhook_url` answers null
 *   otherwise, recorded `suppressed`).
 *
 * Each run of a channel's step that reaches the send calls `record_alert_delivery`, which replaces the
 * channel's row: the rules that fired on it with their changes, `sent`, `failed` or `suppressed` with a
 * reason (`send_retrying` while a seat's send is still being retried). `alert_sent` is counted by the
 * run that completes with a message delivered (`sent`, or `done` from an earlier run). `destination_hash` is an HMAC under the mail pepper:
 * for email, over the recipients' address hashes, sorted; for Slack, over the webhook URL. Neither
 * an address nor the URL is stored, logged, returned or put in an event.
 */
import { createHmac } from 'node:crypto';
import { hashMailAddress } from '../mail/address-hash';
import { unsubscribeHeaders } from '../mail/headers';
import type { UnsubscribeLinks } from '../mail/links';
import { send, type MailDeps, type SendOutcome } from '../mail/send';
import { alertTemplate, type MailChange } from '../mail/templates/alert';
import type { Claim } from '../mail/ledger';
import {
  evaluateAlerts,
  type AlertChange,
  type AlertFixEvent,
  type AlertRuleInput,
  type FiredAlert,
} from './alert-rules';
import { slackAlertText, type PostSlack } from './slack';
import type { Verdict } from '@crawlmouse/types/v2';

export type Channel = 'email' | 'slack';

/** The check as alerting reads it. */
export interface AlertContext {
  checkId: string;
  siteId: string;
  /** The site's account now; null for an audit nobody kept. */
  accountId: string | null;
  siteRemoved: boolean;
  accountMarked: boolean;
  /** The site's check before this one; null on its first. */
  previousCheckId: string | null;
  firstCheck: boolean;
  finished: boolean;
  host: string;
  /** The site's Slack channel label, for the record the screens read. */
  slackChannel: string | null;
  finishedAt: string | null;
  zone: string;
}

export type StoredChange = AlertChange & MailChange;

export interface AlertData {
  changes: StoredChange[];
  rules: AlertRuleInput[];
  verdicts: {
    now: Readonly<Record<string, Verdict>>;
    before: Readonly<Record<string, Verdict>> | null;
  };
  textShare: { before: number | null; now: number | null };
  fixEvents: AlertFixEvent[];
}

export interface Delivery {
  check_id: string;
  site_id: string;
  channel: Channel;
  status: 'sent' | 'failed' | 'suppressed';
  reason: string | null;
  destination_hash: string;
  provider_message_id: null;
  slack_channel: string | null;
  sent_at: string;
  rules: { rule_id: string; change_ids: string[] }[];
}

export interface AlertStore {
  context(checkId: string): Promise<AlertContext | null>;
  /** Adds the account's default rules it does not hold yet (Q13, `seed_default_alert_rules`). */
  seedDefaultRules(accountId: string): Promise<void>;
  data(ctx: AlertContext & { accountId: string }): Promise<AlertData>;
  /** The seats to mail about this site: those whose client scope covers it (`alert_email_recipients`). */
  emailRecipients(accountId: string, siteId: string): Promise<{ seatId: string; email: string }[]>;
  slackUrl(accountId: string, now: Date): Promise<string | null>;
  claimSlack(key: string, accountId: string, now: Date): Promise<Claim>;
  finishSlack(
    key: string,
    status: 'sent' | 'failed',
    errorCode: string | null,
    now: Date,
  ): Promise<void>;
  record(delivery: Delivery): Promise<void>;
}

export type AlertLogEvent = 'alert.no_link_secret' | 'alert.slack_failed';

export interface AlertDeps {
  store: AlertStore;
  mail: MailDeps;
  /** EMAIL_LINK_SECRET, or null when unset (Q6). */
  linkSecret: string | null;
  /** The seat's unsubscribe page (footer) and RFC 8058 one-click target (header) for this kind. */
  unsubscribeLinks(secret: string, seatId: string, now: Date): UnsubscribeLinks;
  postSlack: PostSlack;
  capture(accountId: string, properties: { channel: Channel; changes: number }): Promise<void>;
  log(event: AlertLogEvent, fields: Readonly<Record<string, string | number>>): void;
  now(): Date;
}

export type PlanAnswer =
  | { skip: 'no_check' | 'not_finished' | 'unkept' | 'marked' | 'first_check' | 'nothing_fired' }
  | { fired: number; channels: Channel[] };

export type ChannelAnswer =
  | { status: 'none' }
  | { status: Delivery['status']; reason: string | null };

/** Thrown for a Slack send worth retrying; its message is a fixed code, never the URL. */
export class SlackRetry extends Error {
  constructor(readonly code: string) {
    super(`slack send to be retried: ${code}`);
    this.name = 'SlackRetry';
  }
}

/** The destination when there is none to hash: nothing was addressed. */
export const NO_DESTINATION = 'none';

const hmac = (pepper: string, value: string) =>
  createHmac('sha256', pepper).update(value).digest('hex');

export function emailDestinationHash(pepper: string, addresses: readonly string[]): string {
  const hashes = addresses.map((a) => hashMailAddress(pepper, a)).sort();
  return hmac(pepper, `alert-email:${hashes.join(',')}`);
}

export function slackDestinationHash(pepper: string, url: string): string {
  return hmac(pepper, `alert-slack:${url}`);
}

const SLACK_CHANNEL = /^#[a-z0-9_-]+$/;

type Kept = AlertContext & { accountId: string };

type Skip = Exclude<Extract<PlanAnswer, { skip: string }>['skip'], 'nothing_fired'>;
type Loaded = { skip: Skip } | { ctx: Kept; data: AlertData; fired: FiredAlert[] };

async function load(deps: AlertDeps, checkId: string): Promise<Loaded> {
  const ctx = await deps.store.context(checkId);
  if (ctx === null) return { skip: 'no_check' as const };
  if (!ctx.finished) return { skip: 'not_finished' as const };
  if (ctx.accountId === null || ctx.siteRemoved) return { skip: 'unkept' as const };
  if (ctx.accountMarked) return { skip: 'marked' as const };
  if (ctx.firstCheck) return { skip: 'first_check' as const };
  const kept = ctx as Kept;
  // A kept account's rules exist before they are read, so its first alert has rules to fire (Q13).
  await deps.store.seedDefaultRules(kept.accountId);
  const data = await deps.store.data(kept);
  const fired = evaluateAlerts({
    siteId: kept.siteId,
    checkId: kept.checkId,
    firstCheck: false,
    ...data,
  });
  return { ctx: kept, data, fired };
}

export async function planAlert(deps: AlertDeps, checkId: string): Promise<PlanAnswer> {
  const l = await load(deps, checkId);
  if ('skip' in l) return { skip: l.skip };
  if (l.fired.length === 0) return { skip: 'nothing_fired' };
  const channels = (['email', 'slack'] as const).filter((ch) =>
    l.fired.some((a) => a.channels.includes(ch)),
  );
  return { fired: l.fired.length, channels };
}

function base(ctx: Kept, channel: Channel, fired: FiredAlert[], now: Date) {
  return {
    check_id: ctx.checkId,
    site_id: ctx.siteId,
    channel,
    provider_message_id: null,
    slack_channel:
      channel === 'slack' && ctx.slackChannel && SLACK_CHANNEL.test(ctx.slackChannel)
        ? ctx.slackChannel
        : null,
    sent_at: now.toISOString(),
    rules: fired.map((a) => ({ rule_id: a.ruleId, change_ids: a.changeIds })),
  };
}

/** A seat's send in this run: its outcome, or `retry` when its send threw (a retryable failure). */
export type SeatOutcome = SendOutcome | 'retry';

const DELIVERED: ReadonlySet<SeatOutcome> = new Set(['sent', 'done']);

/** One status for the channel from each recipient's send in this run. */
function emailStatus(outcomes: readonly SeatOutcome[]): Pick<Delivery, 'status' | 'reason'> {
  if (outcomes.some((o) => DELIVERED.has(o))) return { status: 'sent', reason: null };
  if (outcomes.every((o) => o === 'suppressed'))
    return { status: 'suppressed', reason: 'address_suppressed' };
  if (outcomes.every((o) => o === 'unconfigured'))
    return { status: 'suppressed', reason: 'mail_unconfigured' };
  if (outcomes.includes('retry')) return { status: 'failed', reason: 'send_retrying' };
  const failed = outcomes.find((o) => o !== 'suppressed' && o !== 'unconfigured')!;
  return { status: 'failed', reason: `send_${failed}` };
}

/**
 * Sends to every seat, one after another, and catches a seat's thrown send, so a seat being retried
 * stops no other seat. Every seat therefore advances one ledger attempt per run of the step.
 * `retry` is the first error caught, rethrown by the caller after it has recorded the channel.
 */
export async function sendEach<R>(
  recipients: readonly R[],
  sendOne: (r: R) => Promise<SendOutcome>,
): Promise<{ outcomes: SeatOutcome[]; retry: unknown }> {
  const outcomes: SeatOutcome[] = [];
  let retry: unknown = null;
  for (const r of recipients) {
    try {
      outcomes.push(await sendOne(r));
    } catch (e) {
      outcomes.push('retry');
      retry ??= e;
    }
  }
  return { outcomes, retry };
}

export async function deliverAlert(
  deps: AlertDeps,
  checkId: string,
  channel: Channel,
): Promise<ChannelAnswer> {
  const l = await load(deps, checkId);
  if ('skip' in l) return { status: 'none' };
  const fired = l.fired.filter((a) => a.channels.includes(channel));
  if (fired.length === 0) return { status: 'none' };
  const ids = new Set(fired.flatMap((a) => a.changeIds));
  const changes = l.data.changes.filter((c) => ids.has(c.id));
  return channel === 'email'
    ? deliverEmail(deps, l.ctx, fired, changes)
    : deliverSlack(deps, l.ctx, fired, changes);
}

async function deliverEmail(
  deps: AlertDeps,
  ctx: Kept,
  fired: FiredAlert[],
  changes: StoredChange[],
): Promise<ChannelAnswer> {
  const now = deps.now();
  const record = async (d: Pick<Delivery, 'status' | 'reason' | 'destination_hash'>) => {
    await deps.store.record({ ...base(ctx, 'email', fired, now), ...d });
    return { status: d.status, reason: d.reason };
  };
  if (deps.linkSecret === null) {
    deps.log('alert.no_link_secret', { check: ctx.checkId });
    return record({
      status: 'suppressed',
      reason: 'no_link_secret',
      destination_hash: NO_DESTINATION,
    });
  }
  const secret = deps.linkSecret;
  const recipients = await deps.store.emailRecipients(ctx.accountId, ctx.siteId);
  if (recipients.length === 0) {
    return record({
      status: 'suppressed',
      reason: 'no_recipients',
      destination_hash: NO_DESTINATION,
    });
  }
  const { outcomes, retry } = await sendEach(recipients, (r) => {
    const links = deps.unsubscribeLinks(secret, r.seatId, now);
    return send(deps.mail, {
      kind: 'alert',
      to: r.email,
      idempotencyKey: `alert:${ctx.checkId}:email:${r.seatId}`,
      accountId: ctx.accountId,
      render: async () =>
        alertTemplate({
          host: ctx.host,
          checkId: ctx.checkId,
          checkedAt: ctx.finishedAt ?? now.toISOString(),
          zone: ctx.zone,
          changes,
          unsubscribeUrl: links.page,
        }),
      headers: () => unsubscribeHeaders({ url: links.oneClick }),
    });
  });
  const pepper = deps.mail.pepper;
  // Recorded on every run, so the channel has a row even when the step's last retry fails; the
  // record replaces the one before it (record_alert_delivery).
  const answer = await record({
    ...emailStatus(outcomes),
    destination_hash:
      pepper === null
        ? NO_DESTINATION
        : emailDestinationHash(
            pepper,
            recipients.map((r) => r.email),
          ),
  });
  if (retry !== null) throw retry;
  // Counted on the run that completes: a send whose record or count failed is `done` on the retry.
  if (outcomes.some((o) => DELIVERED.has(o))) {
    await deps.capture(ctx.accountId, { channel: 'email', changes: changes.length });
  }
  return answer;
}

async function deliverSlack(
  deps: AlertDeps,
  ctx: Kept,
  fired: FiredAlert[],
  changes: StoredChange[],
): Promise<ChannelAnswer> {
  const now = deps.now();
  const record = async (d: Pick<Delivery, 'status' | 'reason' | 'destination_hash'>) => {
    await deps.store.record({ ...base(ctx, 'slack', fired, now), ...d });
    return { status: d.status, reason: d.reason };
  };
  const url = await deps.store.slackUrl(ctx.accountId, now);
  if (url === null) {
    return record({
      status: 'suppressed',
      reason: 'slack_unavailable',
      destination_hash: NO_DESTINATION,
    });
  }
  const pepper = deps.mail.pepper;
  if (pepper === null) {
    return record({
      status: 'suppressed',
      reason: 'unconfigured',
      destination_hash: NO_DESTINATION,
    });
  }
  const destination_hash = slackDestinationHash(pepper, url);
  const key = `alert:${ctx.checkId}:slack`;
  const claim = await deps.store.claimSlack(key, ctx.accountId, now);
  switch (claim.outcome) {
    case 'done': {
      // Posted by an earlier run whose record or count failed: recorded and counted here.
      const answer = await record({ status: 'sent', reason: null, destination_hash });
      await deps.capture(ctx.accountId, { channel: 'slack', changes: changes.length });
      return answer;
    }
    case 'busy':
      throw new SlackRetry('busy');
    case 'exhausted':
    case 'suppressed':
      return record({ status: 'failed', reason: 'exhausted', destination_hash });
    case 'go':
      break;
  }
  const result = await deps.postSlack(
    url,
    slackAlertText({
      host: ctx.host,
      checkId: ctx.checkId,
      checkedAt: ctx.finishedAt ?? now.toISOString(),
      zone: ctx.zone,
      changes,
    }),
  );
  if (result.ok) {
    await deps.store.finishSlack(key, 'sent', null, deps.now());
    const answer = await record({ status: 'sent', reason: null, destination_hash });
    await deps.capture(ctx.accountId, { channel: 'slack', changes: changes.length });
    return answer;
  }
  await deps.store.finishSlack(key, 'failed', result.code, deps.now());
  if (result.retryable) throw new SlackRetry(result.code);
  deps.log('alert.slack_failed', { check: ctx.checkId, code: result.code });
  return record({ status: 'failed', reason: result.code, destination_hash });
}
