import { createHash, randomBytes } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { adminOver, keptSite, makePaid, person } from '@/lib/v2/account/sites-test-support';
import { hashToken } from '@/lib/v2/account/tokens';

// /s/confirm and /s/pause, the pages a client report's recipient lands on (CC-31 D8), from real
// rows: the service-role client is the PostgREST stand-in over PGlite with every migration applied.
// The reader is signed out.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  cookies: new Map<string, string>(),
}));

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
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db) }));

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => h.db?.close());
beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  h.cookies.clear();
});
afterEach(() => vi.unstubAllEnvs());

const card = (html: string) => /<section[\s\S]*<\/section>/.exec(html)![0];
const confirmPage = async (query: Record<string, string> = {}) =>
  card(
    renderToStaticMarkup(
      await (await import('./page')).default({ searchParams: Promise.resolve(query) }),
    ),
  );
const pausePage = async (query: Record<string, string> = {}) =>
  card(
    renderToStaticMarkup(
      await (await import('../pause/page')).default({ searchParams: Promise.resolve(query) }),
    ),
  );

/** A client of an agency named Summit Digital, with a contact and a schedule: its site. */
async function client() {
  const owner = await person(h.db, 'owner');
  await makePaid(h.db, owner.accountId, 'agency');
  await h.db.query(`update public.accounts set name = 'Summit Digital' where id = $1`, [
    owner.accountId,
  ]);
  const site = await keptSite(h.db, owner.accountId);
  await h.db.query(`select public.set_client($1, $2, $3::jsonb)`, [
    site.id,
    owner.accountId,
    JSON.stringify({ client_contact_email: 'reader@client.example' }),
  ]);
  await h.db.query(`select public.set_report_schedule($1, $2, $3::jsonb, now())`, [
    site.id,
    owner.accountId,
    JSON.stringify({
      cadence: 'weekly',
      iso_weekday: 1,
      time_local: '09:00',
      timezone: 'UTC',
      send_when_unchanged: false,
    }),
  ]);
  return site;
}
/**
 * A link's token: the confirmation's is minted in SQL; the pause link's is the mailer's, and SQL is
 * given its sha256 (lib/v2/mail/report-pause-token.ts).
 */
const issue = async (fn: 'issue_recipient_confirmation' | 'issue_report_pause', siteId: string) => {
  if (fn === 'issue_recipient_confirmation') {
    return (
      await h.db.query<{ r: { token: string } }>(`select public.${fn}($1, now()) r`, [siteId])
    ).rows[0]!.r.token;
  }
  const made = randomBytes(32).toString('base64url');
  await h.db.query(
    `select public.issue_report_pause(
       $1, (select client_contact_email from public.sites where id = $1), $2, now())`,
    [siteId, createHash('sha256').update(made, 'utf8').digest('hex')],
  );
  return made;
};
const row = async (siteId: string) =>
  (
    await h.db.query<{ recipient_confirmed_at: Date | null; paused_by_recipient_at: Date | null }>(
      `select recipient_confirmed_at, paused_by_recipient_at from public.report_schedules where site_id = $1`,
      [siteId],
    )
  ).rows[0]!;

describe('/s/confirm', () => {
  it('is a 404 with V2_CHECKS_PUBLIC unset', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(confirmPage()).rejects.toBeInstanceOf(NotFound);
  });

  it('says what confirming does, with a form that posts no field, and changes nothing by being read', async () => {
    const site = await client();
    const token = await issue('issue_recipient_confirmation', site.id);
    h.cookies.set('cm_link_report_confirm', token);
    const html = await confirmPage();
    expect(html).toContain(
      `Summit Digital would like to send reports about ${site.host} to this address.`,
    );
    expect(html).toMatch(/<form[^>]* action="\/api\/report-files\/confirm"/);
    expect(html).not.toMatch(/<input/);
    expect(html).not.toContain(token);
    expect(html).not.toContain(hashToken(token));
    expect(html).not.toContain('reader@client.example');
    expect((await row(site.id)).recipient_confirmed_at).toBeNull();
  });

  it('says the link cannot be used for no cookie, a value that is not a token, a token in the address, and a pause link’s token', async () => {
    const site = await client();
    const token = await issue('issue_recipient_confirmation', site.id);
    expect(await confirmPage()).toContain('This link can no longer be used');
    expect(await confirmPage({ token })).toContain('This link can no longer be used');
    h.cookies.set('cm_link_report_confirm', 'short');
    expect(await confirmPage()).toContain('This link can no longer be used');
    h.cookies.clear();
    h.cookies.set('cm_link_report_pause', token);
    const html = await confirmPage();
    expect(html).toContain('This link can no longer be used');
    expect(html).not.toMatch(/<form/);
  });

  it('after the form’s answer says it is confirmed, with no form', async () => {
    const html = await confirmPage({ notice: 'report_confirmed' });
    expect(html).toContain('Confirmed. The reports will be sent to this address.');
    expect(html).not.toMatch(/<form/);
  });
});

describe('/s/pause', () => {
  it('is a 404 with V2_CHECKS_PUBLIC unset', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(pausePage()).rejects.toBeInstanceOf(NotFound);
  });

  it('says what stopping does, with a form that posts no field, and pauses nothing by being read', async () => {
    const site = await client();
    const confirmation = await issue('issue_recipient_confirmation', site.id);
    await h.db.query(`select public.confirm_report_recipient($1, now())`, [
      hashToken(confirmation),
    ]);
    const token = await issue('issue_report_pause', site.id);
    h.cookies.set('cm_link_report_pause', token);
    const html = await pausePage();
    expect(html).toContain(`Summit Digital sends reports about ${site.host} to this address.`);
    expect(html).toMatch(/<form[^>]* action="\/api\/report-files\/pause"/);
    expect(html).not.toContain(token);
    expect((await row(site.id)).paused_by_recipient_at).toBeNull();
  });

  it('after the form’s answer says the reports are stopped', async () => {
    const html = await pausePage({ notice: 'report_paused' });
    expect(html).toContain(
      'Paused. No more reports are sent. They start again only if you are asked to confirm again and do.',
    );
    expect(html).not.toMatch(/<form/);
  });

  it('is not indexed, and asks the browser to send no referrer', async () => {
    for (const mod of [await import('./page'), await import('../pause/page')]) {
      expect(mod.metadata).toMatchObject({
        robots: { index: false, follow: false },
        alternates: { canonical: null },
        referrer: 'no-referrer',
      });
      expect(mod.dynamic).toBe('force-dynamic');
    }
  });
});
