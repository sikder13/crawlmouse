/**
 * `send` (D1): the one way a v2 email leaves. In order:
 *
 *   1. With no transport (no RESEND_API_KEY) or no pepper, nothing is claimed and the miss is logged,
 *      so a later deploy with both can still send it.
 *   2. An address that is not a plain address is refused and logged; nothing is claimed.
 *   3. The ledger claim, keyed by the caller's idempotency key, before anything is rendered: `done`,
 *      `suppressed` and `exhausted` end here (the last is logged, as a send we gave up on); `busy`
 *      throws `MailRetry`, so the caller's step is retried after the other claim's two-minute lease.
 *   4. Render, after `go` only: an account link is minted inside `render`, so a replayed event
 *      cannot replace a link already delivered (questions Q10). `render` answering null (the link
 *      expired or was used) records `failed` with `nothing_to_send` and is not retried.
 *   5. Headers built from validated values (headers.ts); a refused header records `failed`.
 *   6. The transport. Sent: recorded with the provider's id. A retryable failure: recorded `failed`
 *      and `MailRetry` thrown, so the step retries and the next claim is the next attempt, three in
 *      all (the migration's rule). Any other failure: recorded and logged, not retried.
 *
 * Nothing here logs the address, the rendered body or the idempotency key's account link.
 */
import { hashMailAddress } from './address-hash';
import { buildOutgoing, HeaderRefused, isPlainAddress } from './headers';
import type { MailLedger } from './ledger';
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

export async function send(deps: MailDeps, req: SendRequest): Promise<SendOutcome> {
  const ref = { kind: req.kind, key: req.idempotencyKey };
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
  const claim = await deps.ledger.claim({
    key: req.idempotencyKey,
    kind: req.kind,
    addressHash: hashMailAddress(deps.pepper, req.to),
    accountId: req.accountId,
    now: deps.now(),
  });
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

  const fail = (errorCode: string) =>
    deps.ledger.finish({
      key: req.idempotencyKey,
      status: 'failed',
      providerId: null,
      errorCode,
      now: deps.now(),
    });

  const mail = await req.render();
  if (mail === null) {
    await fail('nothing_to_send');
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
    if (!(e instanceof HeaderRefused)) throw e;
    await fail('header_refused');
    deps.log('mail.header_refused', { ...ref, field: e.field });
    return 'refused';
  }

  const result = await deps.transport.send(outgoing);
  if (result.ok) {
    await deps.ledger.finish({
      key: req.idempotencyKey,
      status: 'sent',
      providerId: result.providerId,
      errorCode: null,
      now: deps.now(),
    });
    return 'sent';
  }
  await fail(result.code);
  if (result.retryable) throw new MailRetry(result.code);
  deps.log('mail.failed', { ...ref, code: result.code, attempt: claim.attempt });
  return 'failed';
}
