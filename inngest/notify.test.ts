import { describe, it, expect, vi } from 'vitest';
import { sendAuditNotification, buildNotifyEmail } from './notify';

// SPEC 04 §2 — V3 (the email-me-when-done valve, completion side). Contracts:
//   - sends ONLY for a completed audit with a pending (un-notified) notify_email;
//   - marks notified_at with an is-null guard so a step retry can never double-send;
//   - NEVER throws (it runs inside auditFn's flow — an email failure must not fail the audit);
//   - the email is neutral + non-customizable: capability link, a claim CTA, and the
//     "didn't request this" line; NO grade/score (results live behind the link), no user content.

interface Row {
  notify_email: string | null;
  notified_at: string | null;
  status: string;
  url: string;
}

function fakeSb(row: Row | null, opts: { updateRows?: number; selectError?: unknown } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const sb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            opts.selectError ? Promise.reject(opts.selectError) : Promise.resolve({ data: row, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          is: () => ({
            select: () => {
              updates.push(payload);
              const n = opts.updateRows ?? 1;
              return Promise.resolve({ data: Array.from({ length: n }, () => ({ id: 'aud-1' })), error: null });
            },
          }),
        }),
      }),
    }),
  };
  return { sb, updates };
}

const ROW: Row = { notify_email: 'owner@example.com', notified_at: null, status: 'completed', url: 'https://example.com/shop' };

describe('sendAuditNotification', () => {
  it('sends exactly one neutral email and marks notified_at for a pending request on a completed audit', async () => {
    const sendEmail = vi.fn(async () => {});
    const { sb, updates } = fakeSb(ROW);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendAuditNotification(sb as any, 'aud-1', { sendEmail });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, msg] = sendEmail.mock.calls[0] as unknown as [string, { subject: string; text: string }];
    expect(to).toBe('owner@example.com');
    expect(msg.subject).toContain('example.com');
    expect(msg.text).toContain('/audit/aud-1'); // the capability link
    expect(msg.text.toLowerCase()).toContain('claim'); // the soft claim CTA
    expect(msg.text.toLowerCase()).toContain("didn't request"); // anti-abuse line
    expect(msg.text).not.toMatch(/grade|score/i); // neutral: results live behind the link
    expect(updates.length).toBe(1);
    expect(updates[0]).toHaveProperty('notified_at');
  });

  for (const [label, row] of [
    ['no notify_email', { ...ROW, notify_email: null }],
    ['already notified', { ...ROW, notified_at: '2026-07-07T00:00:00Z' }],
    ['audit not completed', { ...ROW, status: 'failed' }],
    ['missing row', null],
  ] as const) {
    it(`no-ops when ${label}`, async () => {
      const sendEmail = vi.fn(async () => {});
      const { sb } = fakeSb(row as Row | null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sendAuditNotification(sb as any, 'aud-1', { sendEmail });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  }

  it('claims the notification row BEFORE sending (0 rows claimed -> no send; a retry cannot double-send)', async () => {
    const sendEmail = vi.fn(async () => {});
    const { sb } = fakeSb(ROW, { updateRows: 0 }); // another attempt already claimed it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendAuditNotification(sb as any, 'aud-1', { sendEmail });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('NEVER throws — a read error, send error, or update error is swallowed', async () => {
    const boom = vi.fn(async () => { throw new Error('smtp down'); });
    const { sb } = fakeSb(ROW);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(sendAuditNotification(sb as any, 'aud-1', { sendEmail: boom })).resolves.toBeUndefined();
    const { sb: sbErr } = fakeSb(null, { selectError: new Error('db down') });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(sendAuditNotification(sbErr as any, 'aud-1', { sendEmail: vi.fn() })).resolves.toBeUndefined();
  });
});

describe('buildNotifyEmail', () => {
  it('derives the domain from the audited URL and links the capability page on the canonical origin', () => {
    const msg = buildNotifyEmail({ url: 'https://www.example.com/deep/path', auditId: 'aud-9' });
    expect(msg.subject).toContain('example.com');
    expect(msg.text).toContain('https://crawlmouse.com/audit/aud-9');
    expect(msg.html).toContain('https://crawlmouse.com/audit/aud-9');
  });
});
