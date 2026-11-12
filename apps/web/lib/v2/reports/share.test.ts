import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  hashShareToken,
  isShareToken,
  madeLinkIn,
  newShareToken,
  openShareLink,
  SHARE_COOKIE,
  sharedProof,
  shareReport,
  shareTokenIn,
  shareUrl,
  shareViewPath,
  type LinkAnswer,
  type ShareFiles,
  type ShareStore,
} from './share';

// The share link's token, cookies and answers (CC-31 D7), with the store and the bucket faked. The
// routes over the real SQL are app/api/report-files/[id]/share/route.test.ts.

const ORIGIN = 'https://crawlmouse.com';
const REPORT = '6f1c2a8e-0000-4000-8000-000000000001';
const ACCOUNT = '6f1c2a8e-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-12T12:00:00.000Z');

const opened = (format: 'pdf' | 'html' | 'csv' = 'html', reportId = REPORT): LinkAnswer => ({
  outcome: 'open',
  reportId,
  accountId: ACCOUNT,
  siteId: '6f1c2a8e-0000-4000-8000-000000000003',
  kind: format === 'html' ? 'compare' : 'audit_pdf',
  format,
  storagePath: `${ACCOUNT}/${reportId}.x`,
});

function fakes(answer: LinkAnswer) {
  const store: ShareStore = {
    create: vi.fn(async () => ({
      outcome: 'created' as const,
      expiresAt: '2026-12-12T12:00:00.000Z',
    })),
    open: vi.fn(async () => answer),
    read: vi.fn(async () => answer),
    revoke: vi.fn(async () => undefined),
  };
  const files: ShareFiles = {
    signedUrl: vi.fn(async (path: string) => `https://files.example/${path}`),
    read: vi.fn(async () => new TextEncoder().encode('{"stored":true}')),
  };
  const capture = vi.fn(async () => undefined);
  return { store, files, capture, now: () => NOW };
}

describe('the token', () => {
  it('is 22 base64url characters, and not the same twice', () => {
    const tokens = Array.from({ length: 200 }, newShareToken);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Set(tokens).size).toBe(200);
  });

  it('isShareToken accepts that shape and nothing else', () => {
    expect(isShareToken(newShareToken())).toBe(true);
    for (const bad of [
      '',
      'A'.repeat(21),
      'A'.repeat(23),
      `${'A'.repeat(21)}+`,
      `${'A'.repeat(21)}/`,
      `${'A'.repeat(21)}=`,
      `${'A'.repeat(22)}\n`,
      'A'.repeat(43),
      null,
      undefined,
      22,
    ]) {
      expect(isShareToken(bad), String(bad)).toBe(false);
    }
  });

  it('is stored as its sha256 in lowercase hex', () => {
    const token = newShareToken();
    expect(hashShareToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hashShareToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token)).not.toContain(token);
  });

  it('the link is /s/<token> and the proof page’s address is /s/view/<report id>', () => {
    expect(shareUrl(ORIGIN, 'T')).toBe(`${ORIGIN}/s/T`);
    expect(shareViewPath(REPORT)).toBe(`/s/view/${REPORT}`);
  });
});

describe('the cookies', () => {
  it('shareTokenIn reads the share cookie’s token and nothing that is not one', () => {
    const token = newShareToken();
    expect(shareTokenIn(`a=1; ${SHARE_COOKIE}=${token}; b=2`)).toBe(token);
    expect(shareTokenIn(`${SHARE_COOKIE}=${token}x`)).toBeNull();
    expect(shareTokenIn(`${SHARE_COOKIE}x=${token}`)).toBeNull();
    expect(shareTokenIn(`x${SHARE_COOKIE}=${token}`)).toBeNull();
    expect(shareTokenIn('')).toBeNull();
    expect(shareTokenIn(null)).toBeNull();
  });

  it('madeLinkIn reads <report id>.<token> and refuses any other value', () => {
    const token = newShareToken();
    expect(madeLinkIn(`${REPORT}.${token}`)).toEqual({ reportId: REPORT, token });
    for (const bad of [
      undefined,
      null,
      '',
      token,
      `${REPORT}.`,
      `${REPORT}.${token}.x`,
      `not-an-id.${token}`,
      `${REPORT.toUpperCase()}.${token}`,
      `${REPORT}.${token}x`,
    ]) {
      expect(madeLinkIn(bad), String(bad)).toBeNull();
    }
  });
});

describe('shareReport', () => {
  it('hands the store the token of the address it answers, and names only kind and format in the event', async () => {
    const f = fakes(opened());
    const res = await shareReport(
      f,
      { userId: 'user-1', origin: ORIGIN },
      { id: REPORT, account_id: ACCOUNT, kind: 'audit_pdf', format: 'pdf' },
      'json',
    );
    const { url } = (await res.json()) as { url: string };
    const token = url.slice(`${ORIGIN}/s/`.length);
    expect(f.store.create).toHaveBeenCalledWith(REPORT, token, 'user-1', NOW);
    expect(f.capture.mock.calls).toEqual([
      ['report_shared', ACCOUNT, { kind: 'audit_pdf', format: 'pdf' }],
    ]);
    expect(JSON.stringify(f.capture.mock.calls)).not.toContain(token);
  });
});

describe('openShareLink', () => {
  it('asks the store nothing for a value that is not a token', async () => {
    const f = fakes(opened());
    expect((await openShareLink(f, ORIGIN, 'nope')).status).toBe(404);
    expect(f.store.open).not.toHaveBeenCalled();
  });

  it('sends no event and signs nothing for a link that is gone or unknown', async () => {
    for (const [outcome, status] of [
      ['gone', 410],
      ['unknown', 404],
    ] as const) {
      const f = fakes({ outcome });
      expect((await openShareLink(f, ORIGIN, newShareToken())).status).toBe(status);
      expect(f.capture).not.toHaveBeenCalled();
      expect(f.files.signedUrl).not.toHaveBeenCalled();
    }
  });

  it.each(['pdf', 'csv'] as const)('signs a %s for 60 seconds and sets no cookie', async (fmt) => {
    const f = fakes(opened(fmt));
    const res = await openShareLink(f, ORIGIN, newShareToken());
    expect(res.status).toBe(302);
    expect(f.files.signedUrl).toHaveBeenCalledWith(`${ACCOUNT}/${REPORT}.x`, 60);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('a proof page’s redirect holds the report’s id, and the token only in the cookie', async () => {
    const f = fakes(opened('html'));
    const token = newShareToken();
    const res = await openShareLink(f, ORIGIN, token);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/s/view/${REPORT}`);
    expect(res.headers.get('set-cookie')).toContain(
      `${SHARE_COOKIE}=${token}; Path=/s/view/${REPORT};`,
    );
    expect(f.files.signedUrl).not.toHaveBeenCalled();
  });
});

describe('sharedProof', () => {
  it('returns the stored document for a token whose link opens that proof page, without counting a view', async () => {
    const f = fakes(opened('html'));
    const got = await sharedProof(f, REPORT, 'tok');
    expect(got?.report.reportId).toBe(REPORT);
    expect(new TextDecoder().decode(got!.bytes)).toBe('{"stored":true}');
    expect(f.files.read).toHaveBeenCalledWith(`${ACCOUNT}/${REPORT}.x`);
    expect(f.store.read).toHaveBeenCalledWith('tok', NOW);
    expect(f.store.open).not.toHaveBeenCalled();
  });

  it('is null with no token, and reads nothing', async () => {
    const f = fakes(opened('html'));
    expect(await sharedProof(f, REPORT, null)).toBeNull();
    expect(f.store.read).not.toHaveBeenCalled();
  });

  it('is null for a link that is gone, a link of another report and a report that is not a proof page, and reads no file', async () => {
    for (const answer of [
      { outcome: 'gone' } as const,
      { outcome: 'unknown' } as const,
      opened('html', '6f1c2a8e-0000-4000-8000-00000000000f'),
      opened('pdf'),
    ]) {
      const f = fakes(answer);
      expect(await sharedProof(f, REPORT, 'tok')).toBeNull();
      expect(f.files.read).not.toHaveBeenCalled();
    }
  });
});
