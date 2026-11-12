/**
 * `send` (D1): the one way a v2 email leaves. In order:
 *
 *   1. With no transport (no RESEND_API_KEY) or no pepper, nothing is claimed and the miss is logged.
 *      Nothing sends it later: the caller is answered `unconfigured` (an alert records it, a mail
 *      handler returns it as its run's output), and no deploy replays the event that asked for it.
 *   2. An address that is not a plain address is refused and logged; nothing is claimed.
 *   3. The ledger claim, keyed by the caller's idempotency key, before anything is rendered: `done`,
 *      `suppressed` and `exhausted` end here (the last is logged, as a send we gave up on); `busy`
 *      throws `MailRetry`, so the caller's step is retried after the other claim's two-minute lease.
 *      A claim call that throws throws `MailRetry`: nothing was sent, and a claim that did commit before
 *      its answer was lost is taken back after its lease.
 *   4. Render, after `go` only: an account link is minted inside `render`, so a replayed event
 *      cannot replace a link already delivered (questions Q10). `render` answering null (the link
 *      expired or was used) records `failed` with `nothing_to_send` and is not retried.
 *   5. Headers built from validated values (headers.ts); a refused header records `failed`.
 *   6. The transport. Sent: recorded with the provider's id. A retryable failure: recorded `failed`
 *      and `MailRetry` thrown, so the step retries and the next claim is the next attempt, three in
 *      all (the migration's rule). Any other failure: recorded and logged, not retried.
 *
 * After `go` the key is `sending` under this claim. A `render`, header build or transport that throws
 * records `failed` (`render_failed`, `build_failed`, `transport_threw`) and throws `MailRetry`, so the
 * next claim is the next attempt. A `finish` that throws throws `MailRetry` (`finish_failed`); the key is
 * then still `sending`, and the next claim after the two-minute lease is the next attempt, which
 * resends under the same Idempotency-Key (for an account link, see spec 28's known gaps). The tests
 * are send.test.ts's "every failure after the claim".
 *
 * Nothing here logs the address, the rendered body or the idempotency key, which can hold a check's
 * capability id: the log carries the kind and `keyRef`, a hash of the key.
 */
import { createHash } from 'node:crypto';
import { hashMailAddress } from './address-hash';
import { buildOutgoing, HeaderRefused, isPlainAddress } from './headers';
import type { Claim, MailLedger } from './ledger';
import type { MailTransport } from './transport';
import type { MailKind, RenderedMail } from './types';

export interface MailDeps {
  ledger: MailLedger;
  transport: MailTransport | null;
  pepper: string | null;
  now(): Date;
  log(event: MailLogEvent, fields: Readonly<Record<string, string | number | null>>): void;
}

export type MailLogEvent =
  | 'mail.unconfigured'
  | 'mail.invalid_address'
  | 'mail.exhausted'
  | 'mail.nothing_to_send'
  | 'mail.header_refused'
  | 'mail.failed';

export interface SendRequest {
  kind: MailKind;
  to: string;
  idempotencyKey: string;
  accountId: string | null;
  /** Called after the claim answers go; null when there is nothing to send any more. */
  render(): Promise<RenderedMail | null>;
  /** Extra headers (List-Unsubscribe), built after the claim. */
  headers?(): Readonly<Record<string, string>>;
}

export type SendOutcome =
  | 'sent'
  | 'done'
  | 'suppressed'
  | 'exhausted'
  | 'unconfigured'
  | 'invalid_address'
  | 'nothing_to_send'
  | 'refused'
  | 'failed';

/** Thrown for a send worth retrying: the caller's Inngest step retries it. */
export class MailRetry extends Error {
  constructor(readonly code: string) {
    super(`mail send to be retried: ${code}`);
    this.name = 'MailRetry';
  }
}

/** A log line's stand-in for an idempotency key: the first 16 hex characters of its SHA-256. */
export const keyRef = (key: string): string =>
  createHash('sha256').update(key).digest('hex').slice(0, 16);

export async function send(deps: MailDeps, req: SendRequest): Promise<SendOutcome> {
  const ref = { kind: req.kind, key_ref: keyRef(req.idempotencyKey) };
  if (deps.transport === null || deps.pepper === null) {
    deps.log('mail.unconfigured', {
      ...ref,
      transport: deps.transport === null ? 0 : 1,
      pepper: deps.pepper === null ? 0 : 1,
    });
    return 'unconfigured';
  }
  if (!isPlainAddress(req.to)) {
    deps.log('mail.invalid_address', ref);
    return 'invalid_address';
  }
  let claim: Claim;
  try {
    claim = await deps.ledger.claim({
      key: req.idempotencyKey,
      kind: req.kind,
      addressHash: hashMailAddress(deps.pepper, req.to),
      accountId: req.accountId,
      now: deps.now(),
    });
  } catch {
    throw new MailRetry('claim_failed');
  }
  switch (claim.outcome) {
    case 'done':
    case 'suppressed':
      return claim.outcome;
    case 'exhausted':
      deps.log('mail.exhausted', ref);
      return 'exhausted';
    case 'busy':
      throw new MailRetry('busy');
    case 'go':
      break;
  }

  /** Records the claimed send's result; a ledger that fails leaves the key to the next claim. */
  const finish = async (
    status: 'sent' | 'failed',
    providerId: string | null,
    errorCode: string | null,
  ) => {
    try {
      await deps.ledger.finish({
        key: req.idempotencyKey,
        status,
        providerId,
        errorCode,
        now: deps.now(),
      });
    } catch {
      throw new MailRetry('finish_failed');
    }
  };
  /** A throw after the claim: recorded `failed` when the ledger answers, and retried either way. */
  const failRetry = async (code: string): Promise<never> => {
    await finish('failed', null, code).catch(() => undefined);
    throw new MailRetry(code);
  };

  let mail: RenderedMail | null;
  try {
    mail = await req.render();
  } catch {
    return failRetry('render_failed');
  }
  if (mail === null) {
    await finish('failed', null, 'nothing_to_send');
    deps.log('mail.nothing_to_send', ref);
    return 'nothing_to_send';
  }
  let outgoing;
  try {
    outgoing = buildOutgoing({
      to: req.to,
      mail,
      idempotencyKey: req.idempotencyKey,
      headers: req.headers?.(),
    });
  } catch (e) {
    if (!(e instanceof HeaderRefused)) return failRetry('build_failed');
    await finish('failed', null, 'header_refused');
    deps.log('mail.header_refused', { ...ref, field: e.field });
    return 'refused';
  }

  let result;
  try {
    result = await deps.transport.send(outgoing);
  } catch {
    return failRetry('transport_threw');
  }
  if (result.ok) {
    await finish('sent', result.providerId, null);
    return 'sent';
  }
  await finish('failed', null, result.code);
  if (result.retryable) throw new MailRetry(result.code);
  deps.log('mail.failed', { ...ref, code: result.code, attempt: claim.attempt });
  return 'failed';
}
