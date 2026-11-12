import { describe, expect, it, vi } from 'vitest';
import type { Fix } from '@crawlmouse/types/v2';
import { fixture } from '../fixtures';
import { checkRef } from '../pipeline/public';
import { packetPrompt } from '../view/segment/fixes';
import { hashMailAddress } from './address-hash';
import { mailHandlers, type CaptureEvent } from './handlers';
import { memoryLedger, memoryTransport } from './memory';
import { MailRetry, type MailDeps } from './send';
import type { MailStore, NotifyCheck, TrialAccount } from './store';

const PEPPER = 'p'.repeat(40);
const NOW = new Date('2026-11-13T10:00:00.000Z');
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const CHECK = 'c0000000-0000-4000-8000-0000000000aa';
const TOKEN_ID = 't0000000-0000-4000-8000-000000000001';
const RAW = 'R'.repeat(43);
const RAW2 = 'S'.repeat(43);

const FIX: Fix = fixture('bad-site').fixes.find((f) => f.packet !== null)!;

function store(over: Partial<MailStore> = {}): MailStore {
  return {
    accountLinkRecipient: vi.fn(async () => ({ kind: 'email_change', recipient: 'new@example.com' })),
    issueAccountLink: vi.fn(async () => [{ kind: 'email_change', token: RAW }]),
    trialAccount: vi.fn(
      async (): Promise<TrialAccount> => ({
        state: 'pro_trial',
        trialVariant: 'no_card',
        trialEndsAt: '2026-11-16T10:00:00.000Z',
        timezone: 'UTC',
        remind: true,
        marked: false,
        ownerEmail: 'owner@example.com',
      }),
    ),
    notifyCheck: vi.fn(
      async (): Promise<NotifyCheck> => ({
        status: 'finished',
        notifyEmail: 'visitor@example.com',
        host: 'example.com',
        accountId: null,
      }),
    ),
    fixEmailRequest: vi.fn(async () => ({
      toEmail: 'dev@example.com',
      sentAt: null,
      accountId: ACCOUNT,
      host: 'example.com',
      fix: FIX,
    })),
    markFixEmailSent: vi.fn(async () => undefined),
    finishedCheck: vi.fn(async () => ({ trigger: 'scheduled', status: 'finished', accountId: ACCOUNT })),
    ...over,
  };
}

function setup(s: MailStore = store(), suppressed: string[] = []) {
  const ledger = memoryLedger(new Set(suppressed.map((a) => hashMailAddress(PEPPER, a))));
  const transport = memoryTransport();
  const log = vi.fn();
  const mail: MailDeps = { ledger, transport, pepper: PEPPER, now: () => NOW, log };
  const capture = vi.fn<CaptureEvent>(async () => undefined);
  return { h: mailHandlers({ mail, store: s, capture }), ledger, transport, log, capture, s };
}

describe('the account-link emails (Q10)', () => {
  it('claims on the recipient read without minting, then mints once and sends the link', async () => {
    const { h, transport, ledger, s } = setup();
    const data = { accountId: ACCOUNT, template: 'email_change_confirm', tokenId: TOKEN_ID } as const;
    expect(await h.accountEmail(data)).toBe('sent');
    expect(ledger.claims[0]).toMatchObject({
      key: `account_link:${TOKEN_ID}`,
      kind: 'email_change_confirm',
      accountId: ACCOUNT,
    });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.to).toBe('new@example.com');
    expect(transport.sent[0]!.text).toContain(`https://crawlmouse.com/account/email/${RAW}`);
    expect(transport.sent[0]!.text).not.toContain('new@example.com');
    expect(s.issueAccountLink).toHaveBeenCalledTimes(1);
  });

  it('a replayed event sends nothing and mints nothing: the delivered link stays the live one', async () => {
    const { h, transport, s } = setup();
    const data = { accountId: ACCOUNT, template: 'email_change_confirm', tokenId: TOKEN_ID } as const;
    await h.accountEmail(data);
    expect(await h.accountEmail(data)).toBe('done');
    expect(transport.sent).toHaveLength(1);
    expect(s.issueAccountLink).toHaveBeenCalledTimes(1);
  });

  it('the deletion email carries the confirm link and its paired restore link', async () => {
    const s = store({
      accountLinkRecipient: vi.fn(async () => ({ kind: 'delete_confirm', recipient: 'me@example.com' })),
      issueAccountLink: vi.fn(async () => [
        { kind: 'delete_confirm', token: RAW },
        { kind: 'delete_restore', token: RAW2 },
      ]),
    });
    const { h, transport } = setup(s);
    await h.accountEmail({ accountId: ACCOUNT, template: 'account_delete', tokenId: TOKEN_ID });
    expect(transport.sent[0]!.text).toContain(`/account/delete/${RAW}`);
    expect(transport.sent[0]!.text).toContain(`/account/restore/${RAW2}`);
  });

  it('an unusable link claims nothing; a link of another kind sends nothing', async () => {
    const gone = setup(store({ accountLinkRecipient: vi.fn(async () => null) }));
    expect(
      await gone.h.accountEmail({ accountId: ACCOUNT, template: 'email_change_notice', tokenId: TOKEN_ID }),
    ).toBe('link_unusable');
    expect(gone.ledger.claims).toEqual([]);
    const other = setup();
    expect(
      await other.h.accountEmail({ accountId: ACCOUNT, template: 'account_delete', tokenId: TOKEN_ID }),
    ).toBe('kind_mismatch');
    expect(other.ledger.claims).toEqual([]);
  });

  it('a link that was used between the claim and the mint is recorded as nothing to send', async () => {
    const { h, transport, ledger } = setup(store({ issueAccountLink: vi.fn(async () => []) }));
    expect(
      await h.accountEmail({ accountId: ACCOUNT, template: 'email_change_confirm', tokenId: TOKEN_ID }),
    ).toBe('nothing_to_send');
    expect(transport.sent).toEqual([]);
    expect(ledger.rows.get(`account_link:${TOKEN_ID}`)!.status).toBe('failed');
  });
});

describe('the trial reminder', () => {
  const data = { accountId: ACCOUNT, template: 'trial_reminder' } as const;

  it('goes to the owner once per trial end, as account mail with no unsubscribe', async () => {
    const { h, transport, ledger } = setup();
    expect(await h.accountEmail(data)).toBe('sent');
    expect(await h.accountEmail(data)).toBe('done');
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.to).toBe('owner@example.com');
    expect(transport.sent[0]!.headers).toEqual({});
    expect(ledger.claims[0]!.key).toBe(`trial_reminder:${ACCOUNT}:2026-11-16T10:00:00.000Z`);
  });

  it.each([
    ['marked', { marked: true }],
    ['opted_out', { remind: false }],
    ['not_in_trial', { state: 'pro' }],
    ['not_in_trial', { trialEndsAt: null }],
    ['trial_over', { trialEndsAt: '2026-11-13T10:00:00.000Z' }],
    ['no_owner', { ownerEmail: null }],
  ] as const)('sends nothing and claims nothing: %s', async (outcome, over) => {
    const base = await store().trialAccount(ACCOUNT);
    const { h, ledger } = setup(store({ trialAccount: vi.fn(async () => ({ ...base!, ...over })) }));
    expect(await h.accountEmail(data)).toBe(outcome);
    expect(ledger.claims).toEqual([]);
  });
});

describe('check notify (v1’s rules, D2)', () => {
  it('waits while the check runs: no claim, so the end’s event can still send', async () => {
    const running = store({
      notifyCheck: vi.fn(async () => ({
        status: 'running',
        notifyEmail: 'visitor@example.com',
        host: 'example.com',
        accountId: null,
      })),
    });
    const { h, ledger } = setup(running);
    expect(await h.checkNotify(CHECK)).toBe('waiting');
    expect(ledger.claims).toEqual([]);
  });

  it('sends once whichever of the three events comes second, the address as recipient only', async () => {
    const { h, transport } = setup();
    expect(await h.checkNotify(CHECK)).toBe('sent');
    expect(await h.checkNotify(CHECK)).toBe('done');
    expect(transport.sent).toHaveLength(1);
    const m = transport.sent[0]!;
    expect(m.to).toBe('visitor@example.com');
    expect(m.idempotencyKey).toBe(`check_notify:${CHECK}`);
    for (const part of [m.subject, m.text, m.html]) expect(part).not.toContain('visitor@');
    expect(m.text).toContain(`https://crawlmouse.com/audit/${CHECK}`);
  });

  it('a failed check gets the failed copy; a check with no address claims nothing', async () => {
    const failed = setup(
      store({
        notifyCheck: vi.fn(async () => ({
          status: 'failed',
          notifyEmail: 'visitor@example.com',
          host: 'example.com',
          accountId: null,
        })),
      }),
    );
    await failed.h.checkNotify(CHECK);
    expect(failed.transport.sent[0]!.subject).toContain('has ended');
    const none = setup(
      store({
        notifyCheck: vi.fn(async () => ({
          status: 'finished',
          notifyEmail: null,
          host: 'example.com',
          accountId: null,
        })),
      }),
    );
    expect(await none.h.checkNotify(CHECK)).toBe('no_address');
    expect(none.ledger.claims).toEqual([]);
  });

  it('a suppressed address is not mailed', async () => {
    const { h, transport } = setup(store(), ['Visitor@Example.com']);
    expect(await h.checkNotify(CHECK)).toBe('suppressed');
    expect(transport.sent).toEqual([]);
  });

  it('a failed read retries: nothing was claimed', async () => {
    const { h, ledger } = setup(store({ notifyCheck: vi.fn(async () => Promise.reject(new Error('x'))) }));
    await expect(h.checkNotify(CHECK)).rejects.toBeInstanceOf(MailRetry);
    expect(ledger.claims).toEqual([]);
  });
});

describe('the fix to a developer', () => {
  it('sends the packet as the fix page copies it, then records sent_at, once', async () => {
    const s = store();
    const { h, transport } = setup(s);
    expect(await h.fixToDeveloper('r1')).toBe('sent');
    expect(await h.fixToDeveloper('r1')).toBe('done');
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.to).toBe('dev@example.com');
    expect(transport.sent[0]!.text).toContain(packetPrompt(FIX, FIX.packet!));
    expect(transport.sent[0]!.idempotencyKey).toBe('fix_to_developer:r1');
    expect(s.markFixEmailSent).toHaveBeenCalledWith('r1', NOW);
    // The second run marks it too: a run that sent and stopped before marking is finished by the next.
    expect(s.markFixEmailSent).toHaveBeenCalledTimes(2);
  });

  it('does not mark a send that did not go out', async () => {
    const s = store();
    const { h } = setup(s, ['dev@example.com']);
    expect(await h.fixToDeveloper('r1')).toBe('suppressed');
    expect(s.markFixEmailSent).not.toHaveBeenCalled();
  });

  it('a fix with no packet sends nothing', async () => {
    const s = store({
      fixEmailRequest: vi.fn(async () => ({
        toEmail: 'dev@example.com',
        sentAt: null,
        accountId: ACCOUNT,
        host: 'example.com',
        fix: { ...FIX, packet: null },
      })),
    });
    const { h, ledger } = setup(s);
    expect(await h.fixToDeveloper('r1')).toBe('no_packet');
    expect(ledger.claims).toEqual([]);
  });
});

describe('check_finished (D11)', () => {
  it('names the owner read from the database, not the event, and no address or host', async () => {
    const { h, capture } = setup();
    expect(await h.checkFinished(CHECK)).toBe('captured');
    expect(capture).toHaveBeenCalledWith('check_finished', `account:${ACCOUNT}`, {
      trigger: 'scheduled',
      status: 'finished',
      check_ref: checkRef(CHECK),
      source: 'pipeline',
    });
  });

  it('an unkept check is named by its reference', async () => {
    const { h, capture } = setup(
      store({ finishedCheck: vi.fn(async () => ({ trigger: 'manual', status: 'partial', accountId: null })) }),
    );
    await h.checkFinished(CHECK);
    expect(capture.mock.calls[0]![1]).toBe(`check:${checkRef(CHECK)}`);
  });
});
