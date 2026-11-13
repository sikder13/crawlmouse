import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { insertRow, ROWS } from '@/__tests__/helpers/v2-check-tables';
import {
  adminOver,
  scopeWorld,
  sessionOver,
  type Person,
  type ScopeWorld,
} from '@/lib/v2/account/sites-test-support';
import { AGENCY_MONTHLY, PRO_MONTHLY, usd } from '@/lib/billing/prices';
import { pgliteCheckReader } from '@/lib/v2/pipeline/test-support/pglite';
import { newShareToken } from '@/lib/v2/reports/share';

// /reports from real rows (CC-31 D6, D7): the session and service-role clients are the PostgREST
// stand-in over PGlite with every migration applied, and the account is `scopeWorld`'s agency with
// two client sites. Each person acts in the agency through the switcher's cookie.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  cookies: new Map<string, string>(),
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
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db) }));
vi.mock('@/lib/v2/pipeline/load', () => ({ supabaseCheckReader: () => pgliteCheckReader(h.db) }));

let w: ScopeWorld;
/**
 * site1: a stored PDF, a PDF still being made, a stored proof page, and a client report that was
 * sent (it has no file). site2: a stored CSV.
 */
const ids = {
  pdf: randomUUID(),
  pending: randomUUID(),
  proof: randomUUID(),
  sent: randomUUID(),
  csv: randomUUID(),
};

async function report(id: string, site: ScopeWorld['site1'], columns: Record<string, unknown>) {
  await insertRow(h.db, 'reports', {
    ...ROWS.reports(id, w.accountId, site.id, site.check),
    ...columns,
  });
}

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
  w = await scopeWorld(h.db);
  await report(ids.pdf, w.site1, {
    storage_path: `${w.accountId}/${ids.pdf}.pdf`,
    file_state: 'stored',
  });
  await report(ids.pending, w.site1, {
    byte_count: null,
    storage_path: `${w.accountId}/${ids.pending}.pdf`,
    file_state: 'pending',
  });
  await report(ids.proof, w.site1, {
    kind: 'compare',
    format: 'html',
    byte_count: null,
    storage_path: `${w.accountId}/${ids.proof}.doc.json`,
    file_state: 'stored',
  });
  await report(ids.sent, w.site1, {
    kind: 'client_report',
    format: 'html',
    status: 'sent',
    made_by: 'report_schedule',
    sent_at: '2026-11-10T09:00:00.000Z',
    recipient_email: 'client@site-one.example',
    byte_count: null,
  });
  await report(ids.csv, w.site2, {
    kind: 'raw_export',
    format: 'csv',
    byte_count: 2048,
    storage_path: `${w.accountId}/${ids.csv}.csv`,
    file_state: 'stored',
  });
}, 300_000);
afterAll(async () => h.db?.close());
beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://crawlmouse.com');
  h.cookies.clear();
  h.user = null;
});
afterEach(() => vi.unstubAllEnvs());

/** Signed in as `p`, acting in the agency account. */
const as = (p: Pick<Person, 'id' | 'email'>) => {
  h.user = { id: p.id, email: p.email };
  h.cookies.set('cm_account', w.accountId);
};

const page = async (query: Record<string, string> = {}) =>
  renderToStaticMarkup(
    await (await import('./page')).default({ searchParams: Promise.resolve(query) }),
  );

/** The "Reports made" rows: each row's cells as text, and the row's markup. */
function madeRows(html: string): { text: string; html: string }[] {
  const table = /<table[^>]*aria-label="Reports"[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(1).map((m) => ({
    html: m[1]!,
    text: m[1]!
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }));
}
const rowOf = (html: string, id: string) => madeRows(html).find((r) => r.html.includes(id));

describe('/reports', () => {
  it('the proof page a member opens from a row has a document title of its own, and stays out of search results', async () => {
    const { metadata } = await import('./[id]/page');
    expect(metadata).toEqual({
      title: 'Report',
      robots: { index: false, follow: false },
      alternates: { canonical: null },
    });
  });

  it('is a 404 with V2_CHECKS_PUBLIC unset, and the sign-in page for a caller who is not signed in', async () => {
    await expect(page()).rejects.toMatchObject({ to: '/login' });
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(page()).rejects.toBeInstanceOf(NotFound);
  });

  it('carries the account switcher for a person with a seat on two accounts: the way back to their own', async () => {
    // The manager holds a seat on the agency and owns a personal account; here they act in the agency.
    as(w.manager);
    const html = await page();
    expect(html).toMatch(/<form[^>]* action="\/api\/seats\/switch"/);
    expect(html).toContain(`name="accountId" value="${w.manager.accountId}"`);
    // A person with one account is shown no switch.
    as(w.stranger);
    h.cookies.delete('cm_account');
    expect(await page()).not.toContain('/api/seats/switch');
  });

  it('the owner sees both clients’ reports: a stored file to download and share, a proof page to open, a pending one with neither', async () => {
    as(w.owner);
    const html = await page();
    expect(madeRows(html)).toHaveLength(5);

    const pdf = rowOf(html, ids.pdf)!;
    expect(pdf.html).toContain(`href="/api/report-files/${ids.pdf}/download"`);
    expect(pdf.html).toMatch(new RegExp(`<form[^>]* action="/api/report-files/${ids.pdf}/share"`));
    expect(pdf.text).toContain(w.site1.host);

    const proof = rowOf(html, ids.proof)!;
    expect(proof.html).toContain(`href="/reports/${ids.proof}"`);
    expect(proof.html).not.toContain('/download');

    const csv = rowOf(html, ids.csv)!;
    expect(csv.text).toContain(w.site2.host);
    expect(csv.html).toContain(`href="/api/report-files/${ids.csv}/download"`);

    const pending = madeRows(html).find((r) => r.text.includes('Being made'))!;
    expect(pending.html).not.toMatch(/<form|href=/);
    expect(madeRows(html).filter((r) => r.text.includes('Being made'))).toHaveLength(1);
  });

  it('lists a client report that was sent with nothing to open: it has no file, and is not being made', async () => {
    as(w.owner);
    const sent = madeRows(await page()).find((r) => r.text.includes('Client report'))!;
    expect(sent.text).toContain('sent to client@site-one.example');
    expect(sent.text).not.toContain('Being made');
    expect(sent.html).not.toMatch(/<form|href=/);
  });

  it('holds no stored object’s name', async () => {
    as(w.owner);
    const html = await page();
    expect(html).not.toContain('.doc.json');
    expect(html).not.toContain(`${w.accountId}/`);
  });

  it('a developer whose seat covers one client lists that client’s reports, with no share form', async () => {
    as(w.developer);
    const html = await page();
    const rows = madeRows(html);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.text.includes(w.site1.host))).toBe(true);
    expect(html).not.toContain(w.site2.host);
    expect(html).not.toContain(ids.csv);
    expect(html).not.toMatch(/action="\/api\/report-files\/[^"]+\/share"/);
    expect(rowOf(html, ids.pdf)!.html).toContain(`/api/report-files/${ids.pdf}/download`);
  });

  it('an account manager is offered the share forms', async () => {
    as(w.manager);
    expect(await page()).toMatch(
      new RegExp(`<form[^>]* action="/api/report-files/${ids.pdf}/share"`),
    );
  });

  it('shows a link just made on its report’s row, from the cookie, with the notice', async () => {
    as(w.owner);
    const token = newShareToken();
    h.cookies.set('cm_share_made', `${ids.proof}.${token}`);
    const html = await page({ notice: 'share_made' });
    expect(rowOf(html, ids.proof)!.text).toContain(`https://crawlmouse.com/s/${token}`);
    expect(html.split(token)).toHaveLength(2);
    expect(html).toContain(
      'The link is made. It is shown on its report’s row for a short while: copy it now.',
    );
    expect(rowOf(html, ids.proof)!.text).toContain('The link, shown here for a short while:');
  });

  it('shows no link for a cookie that names a report the caller does not list, or is not one this product wrote', async () => {
    as(w.developer);
    const token = newShareToken();
    h.cookies.set('cm_share_made', `${ids.csv}.${token}`);
    expect(await page()).not.toContain(token);
    as(w.owner);
    h.cookies.set('cm_share_made', `${ids.proof}.${token}x`);
    expect(await page()).not.toContain(token);
  });

  it('once a share link exists, names its expiry and offers to withdraw it', async () => {
    as(w.owner);
    await h.db.query(`select public.create_share_link($1, $2, $3, '2026-11-12T12:00:00Z')`, [
      ids.csv,
      'a'.repeat(64),
      w.owner.id,
    ]);
    await h.db.query(
      `update public.share_links set expires_at = now() + interval '30 days' where report_id = $1`,
      [ids.csv],
    );
    await h.db.query(
      `update public.reports set share_expires_at = now() + interval '30 days' where id = $1`,
      [ids.csv],
    );
    const row = rowOf(await page(), ids.csv)!;
    expect(row.text).toMatch(/Link · until \w{3} \d{1,2} \w{3}/);
    expect(row.text).toContain('Withdraw link');
    // The expiry is text; the two buttons are the replacement and the withdrawal.
    const buttons = [...row.html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    expect(buttons.filter((b) => b.includes('until'))).toEqual([]);
    expect(buttons.some((b) => b.startsWith('New link'))).toBe(true);
    expect(buttons.some((b) => b.startsWith('Withdraw link'))).toBe(true);
    expect(row.html).toMatch(
      /name="_method"[^>]* value="DELETE"|value="DELETE"[^>]* name="_method"/,
    );
  });

  it('says what the plan sells in the gate’s words: Agency makes reports and has client reports', async () => {
    as(w.owner);
    const html = await page();
    expect(html).not.toContain(`Pro is ${usd(PRO_MONTHLY)} a month.`);
    expect(html).not.toContain(`Agency is ${usd(AGENCY_MONTHLY)} a month.`);
  });

  it('on Free: the gate’s line, no form that makes a report, and no share form', async () => {
    // The stranger's own account is Free, with no site.
    h.user = { id: w.stranger.id, email: w.stranger.email };
    const html = await page();
    expect(html).toContain(
      `Reports and exports are made on Pro. Pro is ${usd(PRO_MONTHLY)} a month.`,
    );
    expect(html).toContain(
      `Reports sent to a client are made on Agency. Agency is ${usd(AGENCY_MONTHLY)} a month.`,
    );
    expect(html).not.toMatch(/action="\/api\/reports"/);
    expect(html).not.toContain(w.site1.host);
  });
});
