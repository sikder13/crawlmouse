import { describe, expect, it, vi } from 'vitest';
import type { Fix } from '@crawlmouse/types/v2';
import { fixture } from '../fixtures';
import { checkRef } from '../pipeline/public';
import { packetPrompt } from '../view/segment/fixes';
import { hashMailAddress } from './address-hash';
import { guarded } from '../../../../../inngest/mail';
import { mailHandlers, reportMailHandlers, REQUEST_ID_MAX, type CaptureEvent } from './handlers';
import { memoryLedger, memoryTransport } from './memory';
import { MailRetry, type MailDeps } from './send';
import type {
  IssuedClientReport,
  IssuedSeatInvite,
  MailStore,
  NotifyCheck,
  ReportMailStore,
  TrialAccount,
} from './store';

const PEPPER = 'p'.repeat(40);
const NOW = new Date('2026-11-13T10:00:00.000Z');
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const CHECK = 'c0000000-0000-4000-8000-0000000000aa';
const TOKEN_ID = 't0000000-0000-4000-8000-000000000001';
const RAW = 'R'.repeat(43);
const RAW2 = 'S'.repeat(43);
const SEAT = 'e0000000-0000-4000-8000-0000000000a1';
const SITE = '50000000-0000-4000-8000-0000000000a1';
const REPORT = 'd0000000-0000-4000-8000-0000000000a1';
const INVITEE = 'invitee@example.com';
const CONTACT = 'contact@client.example';
/** An invitation's token by its number, so a resend's link can be told from the first. */
const inviteToken = (seq: number) => String(seq).repeat(43);
const SHARE = 'H'.repeat(22);
const PAUSE = 'P'.repeat(43);

const FIX: Fix = fixture('bad-site').fixes.find((f) => f.packet !== null)!;

function store(over: Partial<MailStore> = {}): MailStore {
  return {
    accountLinkRecipient: vi.fn(async () => ({
      kind: 'email_change',
      recipient: 'new@example.com',
    })),
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
    finishedCheck: vi.fn(async () => ({
      trigger: 'scheduled',
      status: 'finished',
      accountId: ACCOUNT,
    })),
    seatInvitation: vi.fn(async () => ({ recipient: INVITEE, accountId: ACCOUNT, marked: false })),
    issueSeatInvite: vi.fn(
      async (_seat: string, seq: number): Promise<IssuedSeatInvite> => ({
        token: inviteToken(seq),
        recipient: INVITEE,
        accountName: 'Summit Digital',
        role: 'developer',
      }),
    ),
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
    const data = {
      accountId: ACCOUNT,
      template: 'email_change_confirm',
      tokenId: TOKEN_ID,
    } as const;
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
    const data = {
      accountId: ACCOUNT,
      template: 'email_change_confirm',
      tokenId: TOKEN_ID,
    } as const;
    await h.accountEmail(data);
    expect(await h.accountEmail(data)).toBe('done');
    expect(transport.sent).toHaveLength(1);
    expect(s.issueAccountLink).toHaveBeenCalledTimes(1);
  });

  it('the deletion email carries the confirm link and its paired restore link', async () => {
    const s = store({
      accountLinkRecipient: vi.fn(async () => ({
        kind: 'delete_confirm',
        recipient: 'me@example.com',
      })),
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
      await gone.h.accountEmail({
        accountId: ACCOUNT,
        template: 'email_change_notice',
        tokenId: TOKEN_ID,
      }),
    ).toBe('link_unusable');
    expect(gone.ledger.claims).toEqual([]);
    const other = setup();
    expect(
      await other.h.accountEmail({
        accountId: ACCOUNT,
        template: 'account_delete',
        tokenId: TOKEN_ID,
      }),
    ).toBe('kind_mismatch');
    expect(other.ledger.claims).toEqual([]);
  });

  it('a link that was used between the claim and the mint is recorded as nothing to send', async () => {
    const { h, transport, ledger } = setup(store({ issueAccountLink: vi.fn(async () => []) }));
    expect(
      await h.accountEmail({
        accountId: ACCOUNT,
        template: 'email_change_confirm',
        tokenId: TOKEN_ID,
      }),
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
    const { h, ledger } = setup(
      store({ trialAccount: vi.fn(async () => ({ ...base!, ...over })) }),
    );
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
    const { h, ledger } = setup(
      store({ notifyCheck: vi.fn(async () => Promise.reject(new Error('x'))) }),
    );
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

describe('a failure around the claim retries the step (inngest/mail.ts `guarded` throws it on)', () => {
  const link = {
    accountId: ACCOUNT,
    template: 'email_change_confirm',
    tokenId: TOKEN_ID,
  } as const;
  const step = (run: () => Promise<string>) => guarded('crawlmouse.mail.test', run);

  it('a claim that fails', async () => {
    const t = setup();
    t.ledger.claim = () => Promise.reject(new Error('claim_email_send: 503'));
    await expect(step(() => t.h.accountEmail(link))).rejects.toMatchObject({ name: 'MailRetry' });
    expect(t.transport.sent).toEqual([]);
  });

  it('a mint that fails after go: recorded failed, retried, and the retry sends', async () => {
    const issue = vi
      .fn<MailStore['issueAccountLink']>()
      .mockRejectedValueOnce(new Error('issue_account_link: 503'))
      .mockResolvedValue([{ kind: 'email_change', token: RAW }]);
    const t = setup(store({ issueAccountLink: issue }));
    await expect(step(() => t.h.accountEmail(link))).rejects.toMatchObject({
      code: 'render_failed',
    });
    expect(t.ledger.rows.get(`account_link:${TOKEN_ID}`)).toMatchObject({
      status: 'failed',
      errorCode: 'render_failed',
    });
    expect(await step(() => t.h.accountEmail(link))).toBe('sent');
    expect(t.transport.sent).toHaveLength(1);
  });

  it('a finish that fails after the send', async () => {
    const t = setup();
    t.ledger.finish = () => Promise.reject(new Error('finish_email_send: 503'));
    await expect(step(() => t.h.checkNotify(CHECK))).rejects.toMatchObject({
      code: 'finish_failed',
    });
  });

  it('a sent_at write that fails: retried, and the retry marks it without sending again', async () => {
    const mark = vi
      .fn<MailStore['markFixEmailSent']>()
      .mockRejectedValueOnce(new Error('fix_email_requests update: 503'))
      .mockResolvedValue(undefined);
    const t = setup(store({ markFixEmailSent: mark }));
    await expect(step(() => t.h.fixToDeveloper('r1'))).rejects.toMatchObject({
      code: 'mark_sent_failed',
    });
    expect(await step(() => t.h.fixToDeveloper('r1'))).toBe('done');
    expect(t.transport.sent).toHaveLength(1);
    expect(mark).toHaveBeenCalledTimes(2);
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
      store({
        finishedCheck: vi.fn(async () => ({
          trigger: 'manual',
          status: 'partial',
          accountId: null,
        })),
      }),
    );
    await h.checkFinished(CHECK);
    expect(capture.mock.calls[0]![1]).toBe(`check:${checkRef(CHECK)}`);
  });
});

describe('the seat invitation (CC-31 D3)', () => {
  it('sends one mail for one invitation, to the invited address, as account mail with no unsubscribe', async () => {
    const { h, transport, ledger, s } = setup();
    expect(await h.seatInvite(SEAT, 1)).toBe('sent');
    expect(ledger.claims).toHaveLength(1);
    expect(ledger.claims[0]).toMatchObject({
      key: `seat_invite:${SEAT}:1`,
      kind: 'seat_invite',
      accountId: ACCOUNT,
      addressHash: hashMailAddress(PEPPER, INVITEE),
    });
    expect(transport.sent).toHaveLength(1);
    const m = transport.sent[0]!;
    expect(m.to).toBe(INVITEE);
    expect(m.headers).toEqual({});
    expect(m.text).toContain(`https://crawlmouse.com/invite/${inviteToken(1)}`);
    expect(m.subject).toBe('You are invited to Summit Digital on Crawlmouse');
    for (const part of [m.subject, m.text, m.html]) expect(part).not.toContain('invitee');
    expect(s.issueSeatInvite).toHaveBeenCalledTimes(1);
    expect(s.issueSeatInvite).toHaveBeenCalledWith(SEAT, 1, NOW);
  });

  it('the same event twice sends once and mints once: the delivered link stays the live one', async () => {
    const { h, transport, s } = setup();
    expect(await h.seatInvite(SEAT, 1)).toBe('sent');
    expect(await h.seatInvite(SEAT, 1)).toBe('done');
    expect(transport.sent).toHaveLength(1);
    expect(s.issueSeatInvite).toHaveBeenCalledTimes(1);
  });

  it('a resend is the next number: another key, a second mail, another link', async () => {
    const { h, transport, ledger } = setup();
    expect(await h.seatInvite(SEAT, 1)).toBe('sent');
    expect(await h.seatInvite(SEAT, 2)).toBe('sent');
    expect(ledger.claims.map((c) => c.key)).toEqual([
      `seat_invite:${SEAT}:1`,
      `seat_invite:${SEAT}:2`,
    ]);
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]!.text).toContain(`/invite/${inviteToken(2)}`);
    expect(transport.sent[1]!.text).not.toContain(inviteToken(1));
  });

  it('mints the link after the claim, and not at all while another worker holds the key', async () => {
    const order: string[] = [];
    const issue = vi.fn(async (_seat: string, seq: number): Promise<IssuedSeatInvite> => {
      order.push('issue');
      return { token: inviteToken(seq), recipient: INVITEE, accountName: null, role: 'developer' };
    });
    const t = setup(store({ issueSeatInvite: issue }));
    const claim = t.ledger.claim.bind(t.ledger);
    t.ledger.claim = async (c) => {
      order.push('claim');
      return claim(c);
    };
    expect(await t.h.seatInvite(SEAT, 1)).toBe('sent');
    expect(order).toEqual(['claim', 'issue']);

    const held = setup(store({ issueSeatInvite: issue }));
    await held.ledger.claim({
      key: `seat_invite:${SEAT}:1`,
      kind: 'seat_invite',
      addressHash: hashMailAddress(PEPPER, INVITEE),
      accountId: ACCOUNT,
      now: NOW,
    });
    await expect(held.h.seatInvite(SEAT, 1)).rejects.toMatchObject({ code: 'busy' });
    expect(issue).toHaveBeenCalledTimes(1);
    expect(held.transport.sent).toEqual([]);
  });

  it('a seat that is not invited any more, or whose invitation was re-sent, claims nothing and mints nothing', async () => {
    const { h, ledger, s } = setup(store({ seatInvitation: vi.fn(async () => null) }));
    expect(await h.seatInvite(SEAT, 1)).toBe('not_invited');
    expect(ledger.claims).toEqual([]);
    expect(s.issueSeatInvite).not.toHaveBeenCalled();
  });

  it('an account marked for deletion sends nothing: no claim, no link', async () => {
    const { h, ledger, s, transport } = setup(
      store({
        seatInvitation: vi.fn(async () => ({
          recipient: INVITEE,
          accountId: ACCOUNT,
          marked: true,
        })),
      }),
    );
    expect(await h.seatInvite(SEAT, 1)).toBe('marked');
    expect(ledger.claims).toEqual([]);
    expect(s.issueSeatInvite).not.toHaveBeenCalled();
    expect(transport.sent).toEqual([]);
  });

  it('an invitation accepted, removed or re-sent between the claim and the mint is nothing to send', async () => {
    const { h, transport, ledger } = setup(store({ issueSeatInvite: vi.fn(async () => null) }));
    expect(await h.seatInvite(SEAT, 1)).toBe('nothing_to_send');
    expect(transport.sent).toEqual([]);
    expect(ledger.rows.get(`seat_invite:${SEAT}:1`)).toMatchObject({
      status: 'failed',
      errorCode: 'nothing_to_send',
    });
  });

  it('a link issued for another address than the one claimed is not mailed', async () => {
    const { h, transport } = setup(
      store({
        issueSeatInvite: vi.fn(
          async (): Promise<IssuedSeatInvite> => ({
            token: inviteToken(1),
            recipient: 'someone-else@example.com',
            accountName: null,
            role: 'developer',
          }),
        ),
      }),
    );
    expect(await h.seatInvite(SEAT, 1)).toBe('nothing_to_send');
    expect(transport.sent).toEqual([]);
  });

  it('an address under a suppression still gets its invitation', async () => {
    const { h, transport } = setup(store(), [INVITEE]);
    expect(await h.seatInvite(SEAT, 1)).toBe('sent');
    expect(transport.sent.map((m) => m.to)).toEqual([INVITEE]);
  });

  it('a failed read retries, and so does a failed mint, whose retry sends', async () => {
    const down = setup(
      store({ seatInvitation: vi.fn(async () => Promise.reject(new Error('x'))) }),
    );
    await expect(down.h.seatInvite(SEAT, 1)).rejects.toBeInstanceOf(MailRetry);
    expect(down.ledger.claims).toEqual([]);

    const issue = vi
      .fn<MailStore['issueSeatInvite']>()
      .mockRejectedValueOnce(new Error('issue_seat_invite: 503'))
      .mockResolvedValue({
        token: inviteToken(1),
        recipient: INVITEE,
        accountName: null,
        role: 'developer',
      });
    const t = setup(store({ issueSeatInvite: issue }));
    await expect(t.h.seatInvite(SEAT, 1)).rejects.toMatchObject({ code: 'render_failed' });
    expect(await t.h.seatInvite(SEAT, 1)).toBe('sent');
    expect(t.transport.sent).toHaveLength(1);
  });

  it('writes no address, token or link into a log line or an event, whatever the outcome', async () => {
    const consoles = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const sent = setup();
    await sent.h.seatInvite(SEAT, 1);
    const gone = setup(store({ issueSeatInvite: vi.fn(async () => null) }));
    await gone.h.seatInvite(SEAT, 1);
    const refused = setup(
      store({
        seatInvitation: vi.fn(async () => ({
          recipient: 'invitee at example.com',
          accountId: ACCOUNT,
          marked: false,
        })),
      }),
    );
    expect(await refused.h.seatInvite(SEAT, 1)).toBe('invalid_address');
    const failing = setup();
    failing.transport.send = async () => ({ ok: false, retryable: false, code: 'provider_422' });
    expect(await failing.h.seatInvite(SEAT, 1)).toBe('failed');

    const lines = JSON.stringify([
      ...[sent, gone, refused, failing].flatMap((t) => [t.log.mock.calls, t.capture.mock.calls]),
      ...consoles.map((c) => c.mock.calls),
    ]);
    expect([sent, gone, refused, failing].flatMap((t) => t.log.mock.calls).length).toBe(3);
    for (const secret of ['invitee', 'example.com', inviteToken(1), '/invite/', SEAT]) {
      expect(lines).not.toContain(secret);
    }
    for (const c of consoles) c.mockRestore();
  });
});

function reportStore(over: Partial<ReportMailStore> = {}): ReportMailStore {
  return {
    confirmationRecipient: vi.fn(async () => ({ recipient: CONTACT, accountId: ACCOUNT })),
    issueConfirmation: vi.fn(async () => ({
      token: RAW,
      recipient: CONTACT,
      agencyName: 'Summit Digital',
      host: 'client.example',
    })),
    clientReportRecipient: vi.fn(async () => ({ recipient: CONTACT, accountId: ACCOUNT })),
    issueClientReport: vi.fn(
      async (): Promise<IssuedClientReport> => ({
        recipient: CONTACT,
        agencyName: 'Summit Digital',
        host: 'client.example',
        headline: 'Report for client.example',
        lines: ['client.example', 'Checked Fri 30 Oct'],
        footer: 'Checked with Crawlmouse · Fri 30 Oct',
        shareToken: SHARE,
        pauseToken: PAUSE,
      }),
    ),
    ...over,
  };
}

function reportSetup(s: ReportMailStore = reportStore(), suppressed: string[] = []) {
  const ledger = memoryLedger(new Set(suppressed.map((a) => hashMailAddress(PEPPER, a))));
  const transport = memoryTransport();
  const log = vi.fn();
  const mail: MailDeps = { ledger, transport, pepper: PEPPER, now: () => NOW, log };
  return { h: reportMailHandlers({ mail, store: s }), ledger, transport, log, s };
}

describe('the confirmation asked of a client’s contact (CC-31 D8)', () => {
  it('sends one mail for one request, to the contact, as account mail with the confirmation link', async () => {
    const { h, transport, ledger, s } = reportSetup();
    expect(await h.reportConfirm(SITE, 'req-1')).toBe('sent');
    expect(ledger.claims[0]).toMatchObject({
      key: `report_confirm:${SITE}:req-1`,
      kind: 'report_confirm',
      accountId: ACCOUNT,
    });
    const m = transport.sent[0]!;
    expect(m.to).toBe(CONTACT);
    expect(m.headers).toEqual({});
    expect(m.text).toContain(`https://crawlmouse.com/s/confirm/${RAW}`);
    expect(m.subject).toBe('Summit Digital asks to send you reports about client.example');
    for (const part of [m.subject, m.text, m.html]) expect(part).not.toContain('contact@');
    expect(s.issueConfirmation).toHaveBeenCalledWith(SITE, NOW);
  });

  it('the same request twice sends once and mints once; the next request is another mail', async () => {
    const { h, transport, s } = reportSetup();
    expect(await h.reportConfirm(SITE, 'req-1')).toBe('sent');
    expect(await h.reportConfirm(SITE, 'req-1')).toBe('done');
    expect(s.issueConfirmation).toHaveBeenCalledTimes(1);
    expect(await h.reportConfirm(SITE, 'req-2')).toBe('sent');
    expect(transport.sent).toHaveLength(2);
  });

  it.each(['', 'r'.repeat(REQUEST_ID_MAX + 1)])(
    'a request id that is empty or too long for the key (%#) reads nothing and claims nothing',
    async (requestId) => {
      const { h, ledger, s } = reportSetup();
      expect(await h.reportConfirm(SITE, requestId)).toBe('invalid_request');
      expect(s.confirmationRecipient).not.toHaveBeenCalled();
      expect(ledger.claims).toEqual([]);
    },
  );

  it('the longest request id makes a key the ledger takes', async () => {
    const { h, ledger } = reportSetup();
    expect(await h.reportConfirm(SITE, 'r'.repeat(REQUEST_ID_MAX))).toBe('sent');
    expect(ledger.claims[0]!.key.length).toBeLessThanOrEqual(200);
  });

  it('a site with no contact to confirm claims nothing', async () => {
    const { h, ledger } = reportSetup(
      reportStore({ confirmationRecipient: vi.fn(async () => null) }),
    );
    expect(await h.reportConfirm(SITE, 'req-1')).toBe('not_found');
    expect(ledger.claims).toEqual([]);
  });

  it('nothing to confirm any more at the mint, or a link minted for another address: nothing is sent', async () => {
    const gone = reportSetup(reportStore({ issueConfirmation: vi.fn(async () => null) }));
    expect(await gone.h.reportConfirm(SITE, 'req-1')).toBe('nothing_to_send');
    const moved = reportSetup(
      reportStore({
        issueConfirmation: vi.fn(async () => ({
          token: RAW,
          recipient: 'new-contact@client.example',
          agencyName: null,
          host: 'client.example',
        })),
      }),
    );
    expect(await moved.h.reportConfirm(SITE, 'req-1')).toBe('nothing_to_send');
    expect([...gone.transport.sent, ...moved.transport.sent]).toEqual([]);
  });

  it('an address under a suppression still gets the confirmation', async () => {
    const { h, transport } = reportSetup(reportStore(), [CONTACT]);
    expect(await h.reportConfirm(SITE, 'req-1')).toBe('sent');
    expect(transport.sent).toHaveLength(1);
  });
});

describe('the client report (CC-31 D8)', () => {
  it('sends once per report: the report’s link, and the pause link in the body and as List-Unsubscribe', async () => {
    const { h, transport, ledger, s } = reportSetup();
    expect(await h.clientReport(REPORT)).toBe('sent');
    expect(await h.clientReport(REPORT)).toBe('done');
    expect(ledger.claims[0]).toMatchObject({
      key: `client_report:${REPORT}`,
      kind: 'client_report',
      accountId: ACCOUNT,
    });
    expect(transport.sent).toHaveLength(1);
    expect(s.issueClientReport).toHaveBeenCalledTimes(1);
    const m = transport.sent[0]!;
    expect(m.to).toBe(CONTACT);
    expect(m.headers).toEqual({
      'List-Unsubscribe': `<https://crawlmouse.com/s/pause/${PAUSE}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(m.text).toContain(`Open the report: https://crawlmouse.com/s/${SHARE}`);
    expect(m.text).toContain(`Pause these reports: https://crawlmouse.com/s/pause/${PAUSE}`);
    expect(m.text).toContain('Report for client.example\nclient.example\nChecked Fri 30 Oct');
    for (const part of [m.subject, m.text, m.html]) expect(part).not.toContain('contact@');
  });

  it('a suppressed address is not mailed, and no link is minted for it', async () => {
    const { h, transport, s } = reportSetup(reportStore(), [CONTACT]);
    expect(await h.clientReport(REPORT)).toBe('suppressed');
    expect(transport.sent).toEqual([]);
    expect(s.issueClientReport).not.toHaveBeenCalled();
  });

  it('no such report claims nothing; a report with nothing to send at the mint sends nothing', async () => {
    const none = reportSetup(reportStore({ clientReportRecipient: vi.fn(async () => null) }));
    expect(await none.h.clientReport(REPORT)).toBe('not_found');
    expect(none.ledger.claims).toEqual([]);
    const gone = reportSetup(reportStore({ issueClientReport: vi.fn(async () => null) }));
    expect(await gone.h.clientReport(REPORT)).toBe('nothing_to_send');
    expect(gone.transport.sent).toEqual([]);
  });

  it('a report minted for another address than the one claimed is not mailed', async () => {
    const base = await reportStore().issueClientReport(REPORT, NOW);
    const { h, transport } = reportSetup(
      reportStore({
        issueClientReport: vi.fn(async () => ({ ...base!, recipient: 'other@client.example' })),
      }),
    );
    expect(await h.clientReport(REPORT)).toBe('nothing_to_send');
    expect(transport.sent).toEqual([]);
  });

  it('a failed read retries: nothing was claimed', async () => {
    const { h, ledger } = reportSetup(
      reportStore({ clientReportRecipient: vi.fn(async () => Promise.reject(new Error('x'))) }),
    );
    await expect(h.clientReport(REPORT)).rejects.toBeInstanceOf(MailRetry);
    expect(ledger.claims).toEqual([]);
  });
});
