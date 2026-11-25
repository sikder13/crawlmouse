import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { insertRow, ROWS } from '@/__tests__/helpers/v2-check-tables';
import {
  addSeat,
  adminOver,
  keptSite,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import type { ReportDoc } from '@/lib/v2/reports/generate';
import { hashShareToken, newShareToken } from '@/lib/v2/reports/share';

// The two proof pages (CC-31 D6b): /s/view/[reportId], opened through a share link signed out, and
// /reports/[id], opened by a member. The clients are the PostgREST stand-in over PGlite with every
// migration applied; the bucket is a map of stored objects, and nothing here calls Storage.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  cookies: new Map<string, string>(),
  objects: new Map<string, string | Uint8Array>(),
  downloads: [] as string[],
  capture: vi.fn(async (..._a: unknown[]) => undefined),
  /** Each rate-limit call's key and bound, and whether the address is past its bound. */
  limits: [] as { key: string; limit: number; windowMs: number }[],
  overLimit: false,
}));

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
class NotFound extends Error {}

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      h.cookies.has(name) ? { name, value: h.cookies.get(name)! } : undefined,
  }),
  headers: async () => new Headers(),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string, limit: number, windowMs: number) => {
    h.limits.push({ key, limit, windowMs });
    return { allowed: !h.overLimit, remaining: 0, resetAt: new Date(Date.now() + 60_000) };
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound();
  },
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => sessionOver(h.db, h.user) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const admin = adminOver(h.db);
    return {
      from: (table: string) => admin.from(table),
      rpc: (fn: string, args: object) => admin.rpc(fn, args),
      storage: {
        from: (bucket: string) => ({
          download: async (path: string) => {
            h.downloads.push(`${bucket}/${path}`);
            const body = h.objects.get(path);
            return body === undefined
              ? { data: null, error: { message: 'not found' } }
              : {
                  data: new Blob([typeof body === 'string' ? body : new Uint8Array(body)]),
                  error: null,
                };
          },
        }),
      },
    };
  },
}));
vi.mock('@/lib/v2/agency/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/agency/events')>()),
  agencyCaptureFor: () => h.capture,
}));

const DOC: ReportDoc = {
  title: 'Before and after',
  lines: ['client.example', 'Checked Thu 29 Oct and Fri 30 Oct'],
  sections: [
    {
      heading: 'Grades',
      blocks: [
        {
          type: 'pair',
          title: 'AI readability',
          before: { label: 'Before', date: 'Thu 29 Oct', value: 'D · 41 of 100', evidence: [] },
          after: { label: 'After', date: 'Fri 30 Oct', value: 'B · 78 of 100', evidence: [] },
        },
      ],
    },
  ],
  notMeasured: ['JavaScript was not run.'],
  footer: { text: 'Checked with Crawlmouse · Fri 30 Oct', href: 'https://crawlmouse.com/' },
};

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => h.db?.close());
beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  h.cookies.clear();
  h.objects.clear();
  h.downloads.length = 0;
  h.capture.mockClear();
  h.user = null;
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Pick<Person, 'id' | 'email'> | null) => {
  h.user = p && { id: p.id, email: p.email };
};

const sharedPage = async (reportId: string) =>
  renderToStaticMarkup(
    await (await import('./page')).default({ params: Promise.resolve({ reportId }) }),
  );
const memberPage = async (id: string) =>
  renderToStaticMarkup(
    await (await import('../../../reports/[id]/page')).default({ params: Promise.resolve({ id }) }),
  );

interface World {
  owner: Person;
  /** A developer whose seat covers the proof page's site. */
  developer: Person;
  /** An account manager whose seat covers another client only. */
  elsewhere: Person;
  stranger: Person;
  /** A proof page with its document stored. */
  proof: string;
  /** A PDF with a stored file. */
  pdf: string;
  /** A proof page whose document is not stored yet. */
  pending: string;
}

async function report(accountId: string, siteId: string, format: 'html' | 'pdf', stored = true) {
  const id = randomUUID();
  const path = `${accountId}/${id}.${format === 'html' ? 'doc.json' : 'pdf'}`;
  await insertRow(h.db, 'reports', {
    ...ROWS.reports(id, accountId, siteId, randomUUID()),
    kind: format === 'html' ? 'compare' : 'audit_pdf',
    format,
    storage_path: path,
    file_state: stored ? 'stored' : 'pending',
  });
  if (stored) h.objects.set(path, format === 'html' ? JSON.stringify(DOC) : '%PDF');
  return id;
}

async function world(): Promise<World> {
  const owner = await person(h.db, 'owner');
  await makePaid(h.db, owner.accountId, 'agency');
  const [site, other] = [
    await keptSite(h.db, owner.accountId),
    await keptSite(h.db, owner.accountId),
  ];
  const [developer, elsewhere, stranger] = [
    await person(h.db, 'developer'),
    await person(h.db, 'elsewhere'),
    await person(h.db, 'stranger'),
  ];
  await addSeat(h.db, owner.accountId, developer, 'developer', [site.id]);
  await addSeat(h.db, owner.accountId, elsewhere, 'account_manager', [other.id]);
  return {
    owner,
    developer,
    elsewhere,
    stranger,
    proof: await report(owner.accountId, site.id, 'html'),
    pdf: await report(owner.accountId, site.id, 'pdf'),
    pending: await report(owner.accountId, site.id, 'html', false),
  };
}

/** A share link of `reportId`, made as SQL makes it: the token its address would carry. */
async function link(w: World, reportId: string): Promise<string> {
  const token = newShareToken();
  await h.db.query(`select public.create_share_link($1, $2, $3, now())`, [
    reportId,
    hashShareToken(token),
    w.owner.id,
  ]);
  return token;
}

const views = async (reportId: string) =>
  (
    await h.db.query<{ n: number }>(
      `select coalesce(sum(view_count), 0)::int n from public.share_links where report_id = $1`,
      [reportId],
    )
  ).rows[0]!.n;

describe('/s/view/[reportId]', () => {
  it('draws the stored document for the link’s token in the cookie, signed out, and counts no second view', async () => {
    const w = await world();
    h.cookies.set('cm_share', await link(w, w.proof));
    const html = await sharedPage(w.proof);
    expect(html).toContain('<h1');
    expect(html).toContain('Before and after');
    expect(html).toContain('D · 41 of 100');
    expect(html).toContain('B · 78 of 100');
    expect(html).toContain('JavaScript was not run.');
    expect(html).toMatch(
      /<a href="https:\/\/crawlmouse\.com\/">Checked with Crawlmouse · Fri 30 Oct<\/a>/,
    );
    expect(h.downloads).toEqual([`reports/${w.owner.accountId}/${w.proof}.doc.json`]);
    expect(await views(w.proof)).toBe(0);
    expect(h.capture.mock.calls).toEqual([
      ['proof_viewed', { accountId: w.owner.accountId, visitor: true }, { via: 'share' }],
    ]);
  });

  it('holds neither the token nor its hash', async () => {
    const w = await world();
    const token = await link(w, w.proof);
    h.cookies.set('cm_share', token);
    const html = await sharedPage(w.proof);
    expect(html).not.toContain(token);
    expect(html).not.toContain(hashShareToken(token));
  });

  it('is a 404 with no cookie, a value that is not a token, and a token no link holds, and reads no file', async () => {
    const w = await world();
    await link(w, w.proof);
    await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);
    h.cookies.set('cm_share', 'short');
    await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);
    h.cookies.set('cm_share', newShareToken());
    await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);
    expect(h.downloads).toEqual([]);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('is bounded for an address as the link is: past sixty an hour it is a 404, and nothing is read', async () => {
    const w = await world();
    h.cookies.set('cm_share', await link(w, w.proof));
    h.limits.length = 0;
    await sharedPage(w.proof);
    expect(h.limits).toEqual([
      {
        key: expect.stringMatching(/^share-view:ip:[0-9a-f]{64}$/),
        limit: 60,
        windowMs: 3_600_000,
      },
    ]);
    h.overLimit = true;
    h.downloads.length = 0;
    try {
      await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);
      expect(h.downloads).toEqual([]);
    } finally {
      h.overLimit = false;
    }
    // A request with no token is a 404 before the bound is counted.
    h.cookies.delete('cm_share');
    h.limits.length = 0;
    await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);
    expect(h.limits).toEqual([]);
  });

  it('is a 404 once the link is revoked, and once it has expired', async () => {
    const w = await world();
    h.cookies.set('cm_share', await link(w, w.proof));
    await sharedPage(w.proof);
    await h.db.query(`select public.revoke_share_links($1, now())`, [w.proof]);
    await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);

    h.cookies.set('cm_share', await link(w, w.proof));
    await sharedPage(w.proof);
    await h.db.query(
      `update public.share_links set expires_at = now() - interval '1 second' where report_id = $1`,
      [w.proof],
    );
    await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);
  });

  it('is a 404 for another report’s link, though that link opens its own', async () => {
    const w = await world();
    const other = await report(
      w.owner.accountId,
      (await keptSite(h.db, w.owner.accountId)).id,
      'html',
    );
    h.cookies.set('cm_share', await link(w, other));
    await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);
    expect(await sharedPage(other)).toContain('Before and after');
  });

  it('is a 404 for a file’s link, a malformed id, and a stored object that is not a document', async () => {
    const w = await world();
    h.cookies.set('cm_share', await link(w, w.pdf));
    await expect(sharedPage(w.pdf)).rejects.toBeInstanceOf(NotFound);
    await expect(sharedPage('not-an-id')).rejects.toBeInstanceOf(NotFound);
    h.cookies.set('cm_share', await link(w, w.proof));
    h.objects.set(`${w.owner.accountId}/${w.proof}.doc.json`, '<html>');
    await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('is a 404 with V2_CHECKS_PUBLIC unset, for a link that would open', async () => {
    const w = await world();
    h.cookies.set('cm_share', await link(w, w.proof));
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(sharedPage(w.proof)).rejects.toBeInstanceOf(NotFound);
    expect(h.downloads).toEqual([]);
  });

  it('is not indexed, and asks the browser to send no referrer', async () => {
    const { metadata, dynamic } = await import('./page');
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false },
      alternates: { canonical: null },
      referrer: 'no-referrer',
    });
    expect(dynamic).toBe('force-dynamic');
  });
});

describe('/s/view/[reportId]: the agency stamped on a shared report (white-label)', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  /** A proof page stored with `brand` stamped on it, and its link's token in the cookie. */
  async function brandedPage(w: World, brand: { name: string; logoPath: string | null }) {
    const id = await report(
      w.owner.accountId,
      (await keptSite(h.db, w.owner.accountId)).id,
      'html',
    );
    h.objects.set(`${w.owner.accountId}/${id}.doc.json`, JSON.stringify({ brand, ...DOC }));
    h.cookies.set('cm_share', await link(w, id));
    return id;
  }

  it('shows the agency’s name, and its logo as a data: address of the stored bytes', async () => {
    const w = await world();
    const logoPath = `agency/${w.owner.accountId}/0123456789abcdef.png`;
    h.objects.set(logoPath, new Uint8Array(PNG));
    const html = await sharedPage(await brandedPage(w, { name: 'Northwind Digital', logoPath }));
    expect(html).toContain('data-proof-brand=""');
    expect(html).toContain('Northwind Digital');
    expect(html).toContain(`src="data:image/png;base64,${PNG.toString('base64')}"`);
    expect(html.indexOf('Northwind Digital')).toBeLessThan(html.indexOf(DOC.title));
  });

  it('shows the name alone, and reads nothing, for a logo path that is not the report’s account’s', async () => {
    const w = await world();
    const other = `agency/${randomUUID()}/0123456789abcdef.png`;
    h.objects.set(other, new Uint8Array(PNG));
    const id = await brandedPage(w, { name: 'Northwind Digital', logoPath: other });
    h.downloads.length = 0;
    const html = await sharedPage(id);
    expect(html).toContain('Northwind Digital');
    expect(html).not.toContain('<img');
    expect(h.downloads.some((d) => d.includes(other))).toBe(false);
  });

  it('shows the name alone for stored bytes that are not a logo', async () => {
    const w = await world();
    const logoPath = `agency/${w.owner.accountId}/0123456789abcdef.png`;
    h.objects.set(logoPath, '<svg onload="alert(1)"/>');
    const html = await sharedPage(await brandedPage(w, { name: 'Northwind Digital', logoPath }));
    expect(html).toContain('Northwind Digital');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('svg');
  });

  it('draws a report with no brand exactly as before: no header of an agency', async () => {
    const w = await world();
    h.cookies.set('cm_share', await link(w, w.proof));
    const html = await sharedPage(w.proof);
    expect(html).not.toContain('data-proof-brand');
    expect(html).not.toContain('<img');
  });
});

describe('/reports/[id]', () => {
  it('is a 404 with V2_CHECKS_PUBLIC unset, and the sign-in page for a caller who is not signed in', async () => {
    const w = await world();
    await expect(memberPage(w.proof)).rejects.toMatchObject({ to: '/login' });
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(memberPage(w.proof)).rejects.toBeInstanceOf(NotFound);
  });

  it('draws the stored document for the owner and for a developer whose seat covers the site', async () => {
    const w = await world();
    for (const who of [w.owner, w.developer]) {
      as(who);
      const html = await memberPage(w.proof);
      expect(html).toContain('B · 78 of 100');
      expect(html).toContain('Checked with Crawlmouse · Fri 30 Oct');
    }
    expect(h.capture.mock.calls).toEqual([
      ['proof_viewed', { accountId: w.owner.accountId, userId: w.owner.id }, { via: 'account' }],
      [
        'proof_viewed',
        { accountId: w.owner.accountId, userId: w.developer.id },
        { via: 'account' },
      ],
    ]);
  });

  it('is a 404 for a seat that does not cover the report’s site and for a stranger, and reads no file', async () => {
    const w = await world();
    for (const who of [w.elsewhere, w.stranger]) {
      as(who);
      await expect(memberPage(w.proof)).rejects.toBeInstanceOf(NotFound);
    }
    expect(h.downloads).toEqual([]);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('is a 404 for a report that is not a proof page, one whose document is not stored, an unknown id and a malformed one', async () => {
    const w = await world();
    as(w.owner);
    for (const id of [w.pdf, w.pending, randomUUID(), 'not-an-id']) {
      await expect(memberPage(id), id).rejects.toBeInstanceOf(NotFound);
    }
    expect(h.downloads).toEqual([]);
  });

  it('is not indexed', async () => {
    const { metadata, dynamic } = await import('../../../reports/[id]/page');
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false },
      alternates: { canonical: null },
    });
    expect(dynamic).toBe('force-dynamic');
  });
});
