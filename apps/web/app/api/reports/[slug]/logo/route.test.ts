import { describe, it, expect, vi, beforeEach } from 'vitest';

// SPEC 04 §5/§11 (V10) — white-label logo upload. Same server-side gates as the toggle (auth → paid →
// domain-verified ownership) + a stricter rate cap, then the byte-authoritative validator (magic +
// header decode, no SVG), then a service-role upload into the report-logos bucket at a content-addressed
// path inside the report's namespace. BLOCKED-ON-RUNBOOK: the bucket (Runbook C) may not exist yet — the
// code fail-softs 503 and the storage client is MOCKED here, so nothing depends on a live bucket.

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

let user: { id: string } | null = { id: 'u-1' };
let rlAllowed = true;
let proUntil: string | null = FUTURE;
let reportRow: Record<string, unknown> | null = null;
let owns = true;
let uploadResult: { data: unknown; error: unknown } = { data: { path: 'x' }, error: null };

const rlCalls: string[] = [];
const uploadMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user } }) } }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string) => { rlCalls.push(key); return Promise.resolve({ allowed: rlAllowed, remaining: 0, resetAt: new Date() }); },
}));
vi.mock('@/lib/reports', () => ({ readReportRow: () => Promise.resolve(reportRow) }));
vi.mock('@/lib/report-ownership', () => ({ isDomainVerifiedForUser: () => Promise.resolve(owns) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { pro_until: proUntil }, error: null }) }) }) }),
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, _bytes: unknown, opts: unknown) => { uploadMock(bucket, path, opts); return Promise.resolve(uploadResult); },
      }),
    },
  }),
}));

import { POST } from './route';
import { MAX_LOGO_BYTES } from '@/lib/logo-validation';

const SLUG = 'slug-xyz';
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function png(w: number, h: number): Uint8Array {
  return Uint8Array.from([...PNG_SIG, 0, 0, 0, 13, ...'IHDR'.split('').map((c) => c.charCodeAt(0)), ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0]);
}

function upload(fileBytes: Uint8Array, o: { type?: string; name?: string; field?: string; slug?: string } = {}) {
  const fd = new FormData();
  fd.append(o.field ?? 'logo', new File([fileBytes as BlobPart], o.name ?? 'logo.png', { type: o.type ?? 'image/png' }));
  const slug = o.slug ?? SLUG;
  return POST(new Request(`http://localhost/api/reports/${slug}/logo`, { method: 'POST', body: fd }), { params: Promise.resolve({ slug }) });
}

beforeEach(() => {
  user = { id: 'u-1' };
  rlAllowed = true;
  proUntil = FUTURE;
  reportRow = { domain: 'ex.com', grade: 'C', hidden_at: null, takedown_requested_at: null, claimed_at: '2026-01-01T00:00:00Z' };
  owns = true;
  uploadResult = { data: { path: `${SLUG}/abc.png` }, error: null };
  rlCalls.length = 0;
  uploadMock.mockClear();
});

describe('POST /api/reports/[slug]/logo (§5/§11, V10)', () => {
  it('401 when unauthenticated — no upload', async () => {
    user = null;
    expect((await upload(png(100, 40))).status).toBe(401);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('429 when the per-user upload cap is exhausted', async () => {
    rlAllowed = false;
    const res = await upload(png(100, 40));
    expect(res.status).toBe(429);
    expect(rlCalls.some((k) => k.startsWith('report-logo:'))).toBe(true);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('402 when the caller is not a paying (Pro) user — no upload', async () => {
    proUntil = PAST;
    expect((await upload(png(100, 40))).status).toBe(402);
    proUntil = null;
    expect((await upload(png(100, 40))).status).toBe(402);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('404 when the report is missing or gone', async () => {
    reportRow = null;
    expect((await upload(png(100, 40))).status).toBe(404);
    reportRow = { domain: 'ex.com', grade: 'C', hidden_at: '2026-07-08T00:00:00Z', takedown_requested_at: null, claimed_at: 'x' };
    expect((await upload(png(100, 40))).status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('403 when the caller has not verified the report domain — no upload', async () => {
    owns = false;
    expect((await upload(png(100, 40))).status).toBe(403);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('400 when no file field is present', async () => {
    const fd = new FormData();
    fd.append('notlogo', 'hello');
    const res = await POST(new Request(`http://localhost/api/reports/${SLUG}/logo`, { method: 'POST', body: fd }), { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('400 when the declared file size exceeds 200 KB (before buffering)', async () => {
    expect((await upload(new Uint8Array(MAX_LOGO_BYTES + 1))).status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('400 for an invalid image (SVG / text passed off as a logo) — no upload', async () => {
    const svg = Uint8Array.from('<svg onload=alert(1)></svg>'.split('').map((c) => c.charCodeAt(0)));
    const res = await upload(svg, { type: 'image/svg+xml', name: 'logo.svg' });
    expect(res.status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('200 stores a valid PNG at a content-addressed path in the report namespace, immutable cache', async () => {
    const res = await upload(png(120, 48));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.logoPath).toMatch(new RegExp(`^${SLUG}/[0-9a-f]{16}\\.png$`)); // slug-scoped + content hash
    const [bucket, path, opts] = uploadMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(bucket).toBe('report-logos');
    expect(path).toMatch(new RegExp(`^${SLUG}/`));
    expect(opts).toMatchObject({ contentType: 'image/png', upsert: true });
    expect(String(opts.cacheControl)).toContain('immutable');
  });

  it('200 stores OUR detected content-type + ext, NEVER the client-declared one (PNG bytes declared text/html)', async () => {
    const res = await upload(png(64, 64), { type: 'text/html', name: 'evil.html' });
    expect(res.status).toBe(200);
    const [, path, opts] = uploadMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(opts.contentType).toBe('image/png'); // from magic bytes, never the spoofed declared type
    expect(path).toMatch(/\.png$/); // ext derived from the real format, not the .html filename
  });

  it('503 fail-soft when the bucket does not exist yet (BLOCKED-ON-RUNBOOK C)', async () => {
    uploadResult = { data: null, error: { message: 'Bucket not found', statusCode: '404' } };
    expect((await upload(png(10, 10))).status).toBe(503);
  });

  it('500 on a genuine (non-missing-bucket) storage error', async () => {
    uploadResult = { data: null, error: { message: 'internal', statusCode: '500' } };
    expect((await upload(png(10, 10))).status).toBe(500);
  });
});
